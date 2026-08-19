"""Student Resume Workspace endpoints.

Students with admin-granted access can:
- See their AI analysis (pros/cons/improvements) from uploaded resume
- Specify a target ATS score they want
- Provide a sample LaTeX template
- Have the AI generate a LaTeX resume matching their requirements
- Compile and preview the LaTeX code in-app
- Upload the built resume to faculty
"""

import io
import json
import logging
import subprocess
import tempfile
import threading

from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsStudent
from apps.core.throttles import AiRateThrottle
from apps.core.utils import log_audit
from apps.placements.ai import AiError, ai_json

from .models import StudentWorkspace
from .serializers import StudentWorkspaceSerializer

logger = logging.getLogger(__name__)


def _get_workspace(student) -> StudentWorkspace:
    """Get or create workspace for a student."""
    workspace, _ = StudentWorkspace.objects.get_or_create(student=student)
    return workspace


# ----- AI Resume Generation Prompt -----

_RESUME_GENERATE_PROMPT = """\
You are a professional resume writer and LaTeX expert. Generate a polished, ATS-friendly resume in LaTeX.

The student's current resume analysis is provided below:
{analysis}

The student's target ATS score: {target_score}/100
The student's requirements: {requirements}

{template_section}

IMPORTANT RULES:
1. Keep every fact (names, dates, roles, projects, skills) EXACTLY as stated in the analysis
2. Improve wording, structure and impact - never invent new facts
3. The resume MUST be valid, compilable LaTeX
4. Use standard LaTeX packages (geometry, enumitem, titlesec, hyperref, xcolor, tabularx)
5. Optimize for ATS: use standard section names (Education, Experience, Skills, Projects)
6. Structure: Contact Info → Summary → Skills → Experience → Projects → Education → Certifications
7. The resume should score close to {target_score} on an ATS scoring system
8. Use the provided template as a starting point if given, otherwise create a clean professional layout
9. Include quantified metrics where possible (e.g., "served 500+ users", "reduced load time by 40%")
10. Return ONLY the complete LaTeX code in a single ```latex code block

The LaTeX MUST be complete and compilable - start with \\documentclass and end with \\end{{document}}.
"""

_SOURCE_CODE_REVIEW_PROMPT = """\
You are reviewing a LaTeX resume for ATS compliance and quality.
The resume LaTeX code is provided below. Evaluate it for:
- ATS compatibility (standard sections, no tables, clean structure)
- Content quality (specificity, quantified metrics, impact statements)
- Skills relevance (matching the target requirements)
- Format quality (clean LaTeX, proper spacing, readable)

Target ATS score: {target_score}/100
Target requirements: {requirements}

Return ONLY a single valid JSON object - no markdown, no code fences:
{{
  "score": 0-100 integer (ATS compliance score),
  "summary": "two or three sentences on the resume's quality",
  "ats_compliance": 0-100 integer (how well it follows ATS best practices),
  "content_quality": 0-100 integer (specificity, metrics, impact),
  "skills_match": 0-100 integer (how well skills match requirements),
  "pros": ["3-5 short strings - what the resume does WELL"],
  "cons": ["3-5 short strings - weaknesses or gaps"],
  "improvements": ["5-8 COMPLETE, concrete action items - exactly what to change"],
  "missing_keywords": ["important ATS keywords MISSING from this resume"]
}}
Be specific and honest. Never invent experience or projects not in the resume.
"""


def _generate_resume_in_thread(workspace_id: int, target_score: int, requirements: str, template_latex: str):
    """Generate a LaTeX resume using AI - runs in background thread."""
    from .models import StudentWorkspace

    workspace = StudentWorkspace.objects.get(id=workspace_id)
    workspace.generated_status = StudentWorkspace.AiStatus.RUNNING
    workspace.generated_error = ""
    workspace.save(update_fields=["generated_status", "generated_error", "updated_at"])

    try:
        # Get the student's current resume analysis for context
        analysis_text = ""
        try:
            resume = workspace.student.resume
            if resume.ai_analysis:
                analysis = resume.ai_analysis
                pros = analysis.get("pros", [])
                cons = analysis.get("cons", [])
                improvements = analysis.get("improvements", [])
                skills = analysis.get("skills", [])
                analysis_text = f"""
Current Resume Analysis:
Score: {resume.ai_score}/100
Pros: {', '.join(pros) if pros else 'None'}
Cons: {', '.join(cons) if cons else 'None'}
Improvements: {', '.join(improvements) if improvements else 'None'}
Skills: {', '.join(skills) if skills else 'None'}
"""
        except Exception:
            analysis_text = "No resume analysis available. Generate based on requirements."

        template_section = ""
        if template_latex.strip():
            template_section = f"""The student provided this LaTeX template to follow:
```latex
{template_latex}
```
Keep the exact same structure/packages/formatting from the template. Only improve the CONTENT."""

        prompt = _RESUME_GENERATE_PROMPT.format(
            analysis=analysis_text,
            target_score=target_score,
            requirements=requirements or "General professional resume",
            template_section=template_section,
        )

        # Call AI to generate LaTeX
        raw = ai_json(
            system_prompt="You are a professional resume writer and LaTeX expert. Generate polished, ATS-friendly resumes in valid LaTeX.",
            user_text=prompt,
            max_tokens=4096,
            reasoning_budget=500,
            task="RESUME_ANALYSIS",
        )

        # Extract LaTeX from the response
        latex_code = raw.get("latex", "")
        if not latex_code:
            # Try to find it in the response
            for key in ["code", "source", "text"]:
                if key in raw and isinstance(raw[key], str):
                    latex_code = raw[key]
                    break

        if not latex_code:
            # Try to parse it as a code block from the full response
            import re
            full_text = json.dumps(raw)
            match = re.search(r'```(?:latex)?\s*\n(.*?)```', full_text, re.DOTALL)
            if match:
                latex_code = match.group(1).strip()

        if not latex_code:
            workspace.generated_status = StudentWorkspace.AiStatus.FAILED
            workspace.generated_error = "AI did not return valid LaTeX code"
            workspace.save(update_fields=["generated_status", "generated_error", "updated_at"])
            return

        # Clean up the latex code
        latex_code = latex_code.strip()
        if latex_code.startswith("```latex"):
            latex_code = latex_code[8:]
        if latex_code.startswith("```"):
            latex_code = latex_code[3:]
        if latex_code.endswith("```"):
            latex_code = latex_code[:-3]
        latex_code = latex_code.strip()

        # Validate basic LaTeX structure
        if "\\documentclass" not in latex_code or "\\begin{document}" not in latex_code:
            workspace.generated_status = StudentWorkspace.AiStatus.FAILED
            workspace.generated_error = "Generated code is not valid LaTeX (missing document structure)"
            workspace.save(update_fields=["generated_status", "generated_error", "updated_at"])
            return

        workspace.generated_latex = latex_code
        workspace.generated_at = timezone.now()
        workspace.generated_status = StudentWorkspace.AiStatus.COMPLETE
        workspace.save(update_fields=[
            "generated_latex", "generated_at", "generated_status", "updated_at"
        ])

        # Now run AI review of the generated resume
        _review_generated_resume(workspace, target_score, requirements)

    except AiError as e:
        workspace.generated_status = StudentWorkspace.AiStatus.FAILED
        workspace.generated_error = f"AI service error: {e}"
        workspace.save(update_fields=["generated_status", "generated_error", "updated_at"])
    except Exception as e:
        logger.exception("Resume generation failed for workspace %s", workspace_id)
        workspace.generated_status = StudentWorkspace.AiStatus.FAILED
        workspace.generated_error = f"Generation failed: {str(e)[:200]}"
        workspace.save(update_fields=["generated_status", "generated_error", "updated_at"])


def _review_generated_resume(workspace, target_score: int, requirements: str):
    """Run AI review on the generated LaTeX resume."""
    from .models import StudentWorkspace

    try:
        prompt = _SOURCE_CODE_REVIEW_PROMPT.format(
            target_score=target_score,
            requirements=requirements or "General professional resume",
        )
        prompt += f"\n\nLaTeX code:\n```latex\n{workspace.generated_latex[:6000]}\n```"

        raw = ai_json(
            system_prompt="You are reviewing a LaTeX resume for ATS compliance and quality.",
            user_text=prompt,
            max_tokens=2000,
            reasoning_budget=300,
            task="RESUME_ANALYSIS",
        )

        workspace.generated_score = raw.get("score", 0)
        workspace.generated_analysis = {
            "summary": raw.get("summary", ""),
            "ats_compliance": raw.get("ats_compliance", 0),
            "content_quality": raw.get("content_quality", 0),
            "skills_match": raw.get("skills_match", 0),
            "pros": raw.get("pros", []),
            "cons": raw.get("cons", []),
            "improvements": raw.get("improvements", []),
            "missing_keywords": raw.get("missing_keywords", []),
        }
        workspace.save(update_fields=[
            "generated_score", "generated_analysis", "updated_at"
        ])

    except Exception as e:
        logger.warning("Resume review failed: %s", e)


def _compile_latex_to_pdf(latex_code: str) -> bytes | None:
    """Compile LaTeX code to PDF using pdflatex. Returns PDF bytes or None."""
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            tex_path = f"{tmpdir}/resume.tex"
            with open(tex_path, "w", encoding="utf-8") as f:
                f.write(latex_code)

            # Run pdflatex twice for references
            for _ in range(2):
                result = subprocess.run(
                    ["pdflatex", "-interaction=nonstopmode", "-output-directory", tmpdir, tex_path],
                    capture_output=True,
                    text=True,
                    timeout=30,
                    cwd=tmpdir,
                )
                if result.returncode != 0 and "Error" in result.stdout:
                    logger.warning("pdflatex error: %s", result.stdout[-500:])
                    return None

            pdf_path = f"{tmpdir}/resume.pdf"
            try:
                with open(pdf_path, "rb") as f:
                    return f.read()
            except FileNotFoundError:
                logger.warning("PDF not generated")
                return None

    except FileNotFoundError:
        logger.warning("pdflatex not installed")
        return None
    except subprocess.TimeoutExpired:
        logger.warning("pdflatex timeout")
        return None
    except Exception as e:
        logger.warning("LaTeX compilation failed: %s", e)
        return None


# ----- API Views -----

class StudentWorkspaceView(APIView):
    """GET/PATCH the student's own workspace."""

    permission_classes = [IsStudent]

    def get(self, request):
        workspace = _get_workspace(request.user)
        if not workspace.is_enabled:
            raise NotFound("Resume workspace is not enabled for your account.")
        return Response(StudentWorkspaceSerializer(workspace).data)


class AdminWorkspaceStatsView(APIView):
    """GET aggregate workspace usage statistics (admin only)."""
    from apps.core.permissions import IsSuperAdmin
    permission_classes = [IsSuperAdmin]

    def get(self, request):
        from django.db.models import Sum
        from django.utils import timezone as tz
        from datetime import timedelta

        total = StudentWorkspace.objects.count()
        enabled = StudentWorkspace.objects.filter(is_enabled=True).count()
        generated = StudentWorkspace.objects.filter(
            generated_status=StudentWorkspace.AiStatus.COMPLETE
        ).count()
        submitted = StudentWorkspace.objects.filter(submitted=True).count()
        totals = StudentWorkspace.objects.aggregate(
            total_generates=Sum("generate_count"),
            total_compiles=Sum("compile_count"),
            total_submits=Sum("submit_count"),
        )

        week_ago = tz.now() - timedelta(days=7)
        recent_generates = StudentWorkspace.objects.filter(
            last_generated_at__gte=week_ago
        ).count()

        top_students = list(
            StudentWorkspace.objects.filter(generate_count__gt=0)
            .select_related("student")
            .order_by("-generate_count")[:10]
            .values(
                roll_number="student__roll_number",
                name="student__full_name",
                generate_count="generate_count",
                compile_count="compile_count",
                submit_count="submit_count",
                generated_score="generated_score",
                target_ats_score="target_ats_score",
            )
        )

        return Response({
            "total_workspaces": total,
            "enabled_workspaces": enabled,
            "completed_generations": generated,
            "total_submitted": submitted,
            "total_generates": totals["total_generates"] or 0,
            "total_compiles": totals["total_compiles"] or 0,
            "total_submits": totals["total_submits"] or 0,
            "recent_generates_7d": recent_generates,
            "top_students": list(top_students),
        })

    def patch(self, request):
        workspace = _get_workspace(request.user)
        if not workspace.is_enabled:
            raise NotFound("Resume workspace is not enabled for your account.")

        editable = {
            "target_ats_score": lambda v: max(0, min(100, int(v))),
            "requirements": lambda v: str(v).strip()[:5000],
            "template_latex": lambda v: str(v).strip()[:20000],
        }
        changed = []
        for field, clean in editable.items():
            if field not in request.data:
                continue
            value = clean(request.data[field])
            setattr(workspace, field, value)
            changed.append(field)

        if not changed:
            raise ValidationError({"detail": "Nothing to update."})

        workspace.save(update_fields=changed + ["updated_at"])
        log_audit(
            request.user, "WORKSPACE_UPDATE", "StudentWorkspace", workspace.id,
            {"fields": changed}, request,
        )
        return Response(StudentWorkspaceSerializer(workspace).data)


class AdminWorkspaceStatsView(APIView):
    """GET aggregate workspace usage statistics (admin only)."""
    from apps.core.permissions import IsSuperAdmin
    permission_classes = [IsSuperAdmin]

    def get(self, request):
        from django.db.models import Sum
        from django.utils import timezone as tz
        from datetime import timedelta

        total = StudentWorkspace.objects.count()
        enabled = StudentWorkspace.objects.filter(is_enabled=True).count()
        generated = StudentWorkspace.objects.filter(
            generated_status=StudentWorkspace.AiStatus.COMPLETE
        ).count()
        submitted = StudentWorkspace.objects.filter(submitted=True).count()
        totals = StudentWorkspace.objects.aggregate(
            total_generates=Sum("generate_count"),
            total_compiles=Sum("compile_count"),
            total_submits=Sum("submit_count"),
        )

        week_ago = tz.now() - timedelta(days=7)
        recent_generates = StudentWorkspace.objects.filter(
            last_generated_at__gte=week_ago
        ).count()

        top_students = list(
            StudentWorkspace.objects.filter(generate_count__gt=0)
            .select_related("student")
            .order_by("-generate_count")[:10]
            .values(
                roll_number="student__roll_number",
                name="student__full_name",
                generate_count="generate_count",
                compile_count="compile_count",
                submit_count="submit_count",
                generated_score="generated_score",
                target_ats_score="target_ats_score",
            )
        )

        return Response({
            "total_workspaces": total,
            "enabled_workspaces": enabled,
            "completed_generations": generated,
            "total_submitted": submitted,
            "total_generates": totals["total_generates"] or 0,
            "total_compiles": totals["total_compiles"] or 0,
            "total_submits": totals["total_submits"] or 0,
            "recent_generates_7d": recent_generates,
            "top_students": list(top_students),
        })


class StudentWorkspaceGenerateView(APIView):
    """POST to start AI resume generation."""

    permission_classes = [IsStudent]
    throttle_classes = [AiRateThrottle]

    def post(self, request):
        workspace = _get_workspace(request.user)
        if not workspace.is_enabled:
            raise NotFound("Resume workspace is not enabled for your account.")

        # Get inputs from request or use stored values
        target_score = int(request.data.get("target_ats_score", workspace.target_ats_score))
        requirements = str(request.data.get("requirements", workspace.requirements)).strip()
        template_latex = str(request.data.get("template_latex", workspace.template_latex)).strip()

        # Save inputs
        workspace.target_ats_score = max(0, min(100, target_score))
        workspace.requirements = requirements[:5000]
        workspace.template_latex = template_latex[:20000]

        # Reset generation state
        workspace.generated_status = StudentWorkspace.AiStatus.PENDING
        workspace.generated_latex = ""
        workspace.generated_score = None
        workspace.generated_analysis = None
        workspace.generated_error = ""
        workspace.compiled_pdf_url = ""
        workspace.compiled_pdf_public_id = ""
        workspace.submitted = False
        workspace.generate_count += 1
        workspace.last_generated_at = timezone.now()
        workspace.save(update_fields=[
            "target_ats_score", "requirements", "template_latex",
            "generated_status", "generated_latex", "generated_score",
            "generated_analysis", "generated_error",
            "compiled_pdf_url", "compiled_pdf_public_id", "submitted",
            "generate_count", "last_generated_at", "updated_at",
        ])

        # Start generation in background thread
        try:
            threading.Thread(
                target=_generate_resume_in_thread,
                args=(workspace.id, target_score, requirements, template_latex),
                daemon=True,
            ).start()
        except Exception:
            pass

        return Response(StudentWorkspaceSerializer(workspace).data)


class AdminWorkspaceStatsView(APIView):
    """GET aggregate workspace usage statistics (admin only)."""
    from apps.core.permissions import IsSuperAdmin
    permission_classes = [IsSuperAdmin]

    def get(self, request):
        from django.db.models import Sum
        from django.utils import timezone as tz
        from datetime import timedelta

        total = StudentWorkspace.objects.count()
        enabled = StudentWorkspace.objects.filter(is_enabled=True).count()
        generated = StudentWorkspace.objects.filter(
            generated_status=StudentWorkspace.AiStatus.COMPLETE
        ).count()
        submitted = StudentWorkspace.objects.filter(submitted=True).count()
        totals = StudentWorkspace.objects.aggregate(
            total_generates=Sum("generate_count"),
            total_compiles=Sum("compile_count"),
            total_submits=Sum("submit_count"),
        )

        week_ago = tz.now() - timedelta(days=7)
        recent_generates = StudentWorkspace.objects.filter(
            last_generated_at__gte=week_ago
        ).count()

        top_students = list(
            StudentWorkspace.objects.filter(generate_count__gt=0)
            .select_related("student")
            .order_by("-generate_count")[:10]
            .values(
                roll_number="student__roll_number",
                name="student__full_name",
                generate_count="generate_count",
                compile_count="compile_count",
                submit_count="submit_count",
                generated_score="generated_score",
                target_ats_score="target_ats_score",
            )
        )

        return Response({
            "total_workspaces": total,
            "enabled_workspaces": enabled,
            "completed_generations": generated,
            "total_submitted": submitted,
            "total_generates": totals["total_generates"] or 0,
            "total_compiles": totals["total_compiles"] or 0,
            "total_submits": totals["total_submits"] or 0,
            "recent_generates_7d": recent_generates,
            "top_students": list(top_students),
        })


class StudentWorkspaceCompileView(APIView):
    """POST to compile the generated LaTeX to PDF."""

    permission_classes = [IsStudent]

    def get(self, request):
        """Check if LaTeX compilation is available on this server."""
        import shutil
        available = shutil.which("pdflatex") is not None
        return Response({"available": available})

    def post(self, request):
        workspace = _get_workspace(request.user)
        if not workspace.is_enabled:
            raise NotFound("Resume workspace is not enabled for your account.")

        if not workspace.generated_latex:
            raise ValidationError({"detail": "No generated resume to compile."})

        # Check if pdflatex is available
        import shutil
        if not shutil.which("pdflatex"):
            raise ValidationError({
                "detail": (
                    "LaTeX compiler (pdflatex) is not installed on this server. "
                    "You can copy the LaTeX code below and compile it locally "
                    "using Overleaf (overleaf.com) or a local LaTeX editor."
                )
            })

        # Try to compile
        pdf_bytes = _compile_latex_to_pdf(workspace.generated_latex)
        if not pdf_bytes:
            raise ValidationError({
                "detail": "LaTeX compilation failed. Check your code for errors."
            })

        # Upload to Cloudinary
        try:
            from apps.documents.services import upload_document

            file_obj = io.BytesIO(pdf_bytes)
            result = upload_document(
                file_obj,
                filename=f"workspace_{workspace.student.roll_number}_resume.pdf",
                folder="workspace",
            )
            workspace.compiled_pdf_url = result.get("url", "")
            workspace.compiled_pdf_public_id = result.get("public_id", "")
            workspace.compiled_at = timezone.now()
            workspace.compile_count += 1
            workspace.save(update_fields=[
                "compiled_pdf_url", "compiled_pdf_public_id", "compiled_at",
                "compile_count", "updated_at",
            ])
        except Exception as e:
            logger.warning("Failed to upload compiled PDF: %s", e)
            raise ValidationError({
                "detail": f"Compilation succeeded but upload failed: {str(e)[:100]}"
            })

        return Response(StudentWorkspaceSerializer(workspace).data)


class AdminWorkspaceStatsView(APIView):
    """GET aggregate workspace usage statistics (admin only)."""
    from apps.core.permissions import IsSuperAdmin
    permission_classes = [IsSuperAdmin]

    def get(self, request):
        from django.db.models import Sum
        from django.utils import timezone as tz
        from datetime import timedelta

        total = StudentWorkspace.objects.count()
        enabled = StudentWorkspace.objects.filter(is_enabled=True).count()
        generated = StudentWorkspace.objects.filter(
            generated_status=StudentWorkspace.AiStatus.COMPLETE
        ).count()
        submitted = StudentWorkspace.objects.filter(submitted=True).count()
        totals = StudentWorkspace.objects.aggregate(
            total_generates=Sum("generate_count"),
            total_compiles=Sum("compile_count"),
            total_submits=Sum("submit_count"),
        )

        week_ago = tz.now() - timedelta(days=7)
        recent_generates = StudentWorkspace.objects.filter(
            last_generated_at__gte=week_ago
        ).count()

        top_students = list(
            StudentWorkspace.objects.filter(generate_count__gt=0)
            .select_related("student")
            .order_by("-generate_count")[:10]
            .values(
                roll_number="student__roll_number",
                name="student__full_name",
                generate_count="generate_count",
                compile_count="compile_count",
                submit_count="submit_count",
                generated_score="generated_score",
                target_ats_score="target_ats_score",
            )
        )

        return Response({
            "total_workspaces": total,
            "enabled_workspaces": enabled,
            "completed_generations": generated,
            "total_submitted": submitted,
            "total_generates": totals["total_generates"] or 0,
            "total_compiles": totals["total_compiles"] or 0,
            "total_submits": totals["total_submits"] or 0,
            "recent_generates_7d": recent_generates,
            "top_students": list(top_students),
        })


class StudentWorkspaceSubmitView(APIView):
    """POST to submit the workspace resume to faculty."""

    permission_classes = [IsStudent]

    def post(self, request):
        workspace = _get_workspace(request.user)
        if not workspace.is_enabled:
            raise NotFound("Resume workspace is not enabled for your account.")

        if not workspace.generated_latex:
            raise ValidationError({"detail": "No generated resume to submit."})

        # Mark as submitted
        workspace.submitted = True
        workspace.submitted_at = timezone.now()
        workspace.submitted_url = workspace.compiled_pdf_url
        workspace.submit_count += 1
        workspace.save(update_fields=[
            "submitted", "submitted_at", "submitted_url",
            "submit_count", "updated_at",
        ])

        log_audit(
            request.user, "WORKSPACE_SUBMIT", "StudentWorkspace", workspace.id,
            {"student": workspace.student.roll_number}, request,
        )

        return Response(StudentWorkspaceSerializer(workspace).data)


class AdminWorkspaceStatsView(APIView):
    """GET aggregate workspace usage statistics (admin only)."""
    from apps.core.permissions import IsSuperAdmin
    permission_classes = [IsSuperAdmin]

    def get(self, request):
        from django.db.models import Sum
        from django.utils import timezone as tz
        from datetime import timedelta

        total = StudentWorkspace.objects.count()
        enabled = StudentWorkspace.objects.filter(is_enabled=True).count()
        generated = StudentWorkspace.objects.filter(
            generated_status=StudentWorkspace.AiStatus.COMPLETE
        ).count()
        submitted = StudentWorkspace.objects.filter(submitted=True).count()
        totals = StudentWorkspace.objects.aggregate(
            total_generates=Sum("generate_count"),
            total_compiles=Sum("compile_count"),
            total_submits=Sum("submit_count"),
        )

        week_ago = tz.now() - timedelta(days=7)
        recent_generates = StudentWorkspace.objects.filter(
            last_generated_at__gte=week_ago
        ).count()

        top_students = list(
            StudentWorkspace.objects.filter(generate_count__gt=0)
            .select_related("student")
            .order_by("-generate_count")[:10]
            .values(
                roll_number="student__roll_number",
                name="student__full_name",
                generate_count="generate_count",
                compile_count="compile_count",
                submit_count="submit_count",
                generated_score="generated_score",
                target_ats_score="target_ats_score",
            )
        )

        return Response({
            "total_workspaces": total,
            "enabled_workspaces": enabled,
            "completed_generations": generated,
            "total_submitted": submitted,
            "total_generates": totals["total_generates"] or 0,
            "total_compiles": totals["total_compiles"] or 0,
            "total_submits": totals["total_submits"] or 0,
            "recent_generates_7d": recent_generates,
            "top_students": list(top_students),
        })


# ----- Admin Views -----

class AdminWorkspaceListView(APIView):
    """GET all student workspaces (admin only)."""
    from apps.core.permissions import IsSuperAdmin
    permission_classes = [IsSuperAdmin]

    def get(self, request):
        workspaces = StudentWorkspace.objects.select_related("student", "student__branch", "student__section")
        roll = request.query_params.get("roll", "").strip()
        if roll:
            workspaces = workspaces.filter(student__roll_number__icontains=roll.upper())

        data = []
        for ws in workspaces:
            data.append({
                "id": ws.id,
                "student_roll": ws.student.roll_number,
                "student_name": ws.student.full_name,
                "branch": ws.student.branch.name if ws.student.branch else "",
                "section": ws.student.section.name if ws.student.section else "",
                "is_enabled": ws.is_enabled,
                "enabled_at": ws.enabled_at,
                "generated_status": ws.generated_status,
                "generated_score": ws.generated_score,
                "submitted": ws.submitted,
                "target_ats_score": ws.target_ats_score,
                "generate_count": ws.generate_count,
                "compile_count": ws.compile_count,
                "submit_count": ws.submit_count,
                "last_generated_at": ws.last_generated_at,
                "updated_at": ws.updated_at,
            })

        return Response(data)


class AdminWorkspaceToggleView(APIView):
    """POST to enable/disable workspace for a student (admin only)."""
    from apps.core.permissions import IsSuperAdmin
    permission_classes = [IsSuperAdmin]

    def post(self, request):
        student_id = request.data.get("student_id")
        enabled = request.data.get("enabled", True)

        if not student_id:
            raise ValidationError({"student_id": "Required."})

        from .models import User
        try:
            student = User.objects.get(id=student_id, role=User.Role.STUDENT)
        except User.DoesNotExist:
            raise NotFound("Student not found.")

        workspace, _ = StudentWorkspace.objects.get_or_create(student=student)
        workspace.is_enabled = enabled
        workspace.enabled_by = request.user
        workspace.enabled_at = timezone.now()
        workspace.save(update_fields=["is_enabled", "enabled_by", "enabled_at", "updated_at"])

        log_audit(
            request.user, "WORKSPACE_TOGGLE", "StudentWorkspace", workspace.id,
            {"student": student.roll_number, "enabled": enabled}, request,
        )

        return Response(StudentWorkspaceSerializer(workspace).data)


class AdminWorkspaceStatsView(APIView):
    """GET aggregate workspace usage statistics (admin only)."""
    from apps.core.permissions import IsSuperAdmin
    permission_classes = [IsSuperAdmin]

    def get(self, request):
        from django.db.models import Sum
        from django.utils import timezone as tz
        from datetime import timedelta

        total = StudentWorkspace.objects.count()
        enabled = StudentWorkspace.objects.filter(is_enabled=True).count()
        generated = StudentWorkspace.objects.filter(
            generated_status=StudentWorkspace.AiStatus.COMPLETE
        ).count()
        submitted = StudentWorkspace.objects.filter(submitted=True).count()
        totals = StudentWorkspace.objects.aggregate(
            total_generates=Sum("generate_count"),
            total_compiles=Sum("compile_count"),
            total_submits=Sum("submit_count"),
        )

        week_ago = tz.now() - timedelta(days=7)
        recent_generates = StudentWorkspace.objects.filter(
            last_generated_at__gte=week_ago
        ).count()

        top_students = list(
            StudentWorkspace.objects.filter(generate_count__gt=0)
            .select_related("student")
            .order_by("-generate_count")[:10]
            .values(
                roll_number="student__roll_number",
                name="student__full_name",
                generate_count="generate_count",
                compile_count="compile_count",
                submit_count="submit_count",
                generated_score="generated_score",
                target_ats_score="target_ats_score",
            )
        )

        return Response({
            "total_workspaces": total,
            "enabled_workspaces": enabled,
            "completed_generations": generated,
            "total_submitted": submitted,
            "total_generates": totals["total_generates"] or 0,
            "total_compiles": totals["total_compiles"] or 0,
            "total_submits": totals["total_submits"] or 0,
            "recent_generates_7d": recent_generates,
            "top_students": list(top_students),
        })
