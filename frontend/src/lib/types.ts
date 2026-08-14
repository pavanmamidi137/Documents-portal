export type Role = "SUPER_ADMIN" | "CR" | "FACULTY" | "STUDENT";

export type Gender = "MALE" | "FEMALE" | "OTHER" | "";
export type FacultyAccess = "RESUME" | "PLACEMENT" | "BOTH" | "";

export interface User {
  id: number;
  roll_number: string;
  full_name: string;
  email: string | null;
  phone: string;
  gender: Gender;
  gender_label: string;
  avatar_url: string;
  faculty_access: FacultyAccess;
  faculty_access_label: string;
  passout_year: number | null;
  role: Role;
  role_label: string;
  branch: number | null;
  branch_name: string | null;
  branch_code: string;
  section: number | null;
  section_name: string | null;
  is_active: boolean;
  is_super_admin: boolean;
  /** Present only for admins (auth user + admin list) - undefined for others. */
  is_primary_admin?: boolean;
  is_cr: boolean;
  is_faculty: boolean;
  is_student: boolean;
  profile_completion: number;
  date_joined: string;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface Branch {
  id: number;
  name: string;
  code: string;
  sections_count: number;
  students_count: number;
  created_at: string;
}

export interface Section {
  id: number;
  branch: number;
  branch_name: string;
  branch_code: string;
  name: string;
  students_count: number;
  created_at: string;
}

export interface Semester {
  id: number;
  name: string;
  order: number;
  subjects_count: number;
  documents_count: number;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  icon: string;
  documents_count: number;
  created_at: string;
}

export interface Subject {
  id: number;
  name: string;
  code: string;
  semester: number;
  semester_name: string;
  branch: number | null;
  branch_name: string | null;
  branch_code: string;
  documents_count: number;
  created_at: string;
}

export interface DocumentItem {
  id: number;
  title: string;
  description: string;
  submission_deadline: string | null;
  file_name: string;
  file_size: number;
  public_id: string;
  cloudinary_url: string;
  download_url: string;
  downloads: number;
  created_at: string;
  /** Admin grouped view: every section this file is shared to. */
  sections?: string[];
  /** Admin grouped view: how many sections have this file. */
  section_count?: number;
  /** Admin grouped view: downloads summed across all copies. */
  total_downloads?: number;
  branch: number;
  branch_name: string;
  branch_code: string;
  section: number;
  section_name: string;
  semester: number;
  semester_name: string;
  category: number;
  category_name: string;
  subject: number;
  subject_name: string;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  forked_from: number | null;
  is_missing: boolean;
  restored_at: string | null;
  /** Extracted-text status: NONE | PENDING | COMPLETE | FAILED. */
  ocr_status?: string;
  ocr_error?: string;
  ocr_updated_at?: string | null;
}

export interface Announcement {
  id: number;
  title: string;
  body: string;
  visibility: string;
  visibility_label: string;
  branch: number | null;
  section: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: number;
  actor_name: string;
  actor_roll: string;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

export interface DashboardData {
  role: Role;
  totals: Record<string, number>;
  charts?: {
    by_category: { category__name: string; count: number }[];
    by_branch: { branch__name: string; count: number }[];
    students_by_branch: { branch__name: string; count: number }[];
    by_passout_year: { passout_year: number; count: number }[];
    over_time: { date: string; count: number }[];
  };
  recent_uploads: DocumentItem[];
  recent_announcements?: { id: number; title: string; created_at: string }[];
}

export interface MetaData {
  branches: Branch[];
  sections: Section[];
  semesters: Semester[];
  categories: Category[];
  subjects: Subject[];
  /** The semester currently running, guessed from the date - forms pre-select it. */
  current_semester: Semester | null;
}

export interface SearchStudent {
  id: number;
  roll_number: string;
  full_name: string;
  email: string | null;
  phone: string;
  role: Role;
  branch_name: string | null;
  branch_code: string;
  section_name: string | null;
  is_active: boolean;
}

export interface SearchResults {
  students: SearchStudent[];
  documents: DocumentItem[];
  announcements: Announcement[];
}

export interface ResumeAiAnalysis {
  summary: string;
  /** What the resume does well - shown as "Pros". */
  pros: string[];
  /** Genuine weaknesses - shown as "Cons". */
  cons: string[];
  /** Backwards-compatible alias of pros (older reports). */
  strengths: string[];
  /** Complete, actionable improvement list. */
  improvements: string[];
  skills: string[];
  ats_keywords: string[];
  /** True when the report was read from the page images (scanned PDF via OCR). */
  ocr?: boolean;
}

export interface ResumeLimits {
  daily_ai_requests: number;
  /** Rolling window (days) for the AI review budget - default 7 (weekly). */
  ai_review_window_days: number;
  ats_view_interval_days: number | null;
  daily_resume_uploads: number;
  /** Rolling window (days) for resume uploads - default 2. */
  resume_upload_window_days: number;
  unlimited_ai: boolean;
  ai_requests_used: number;
  resume_uploads_used: number;
  /** When the next AI review slot opens (ISO) - null when a review is available now. */
  next_ai_review_at: string | null;
}

export interface Resume {
  id: number;
  student: number;
  student_roll: string;
  student_name: string;
  student_avatar_url?: string;
  student_gender_label?: string;
  branch_name: string | null;
  branch_code: string;
  section_name: string | null;
  file_name: string;
  file_size: number;
  cloudinary_url: string;
  is_reviewed: boolean;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  is_missing: boolean;
  restored_at: string | null;
  ai_status: "PENDING" | "COMPLETE" | "FAILED";
  ai_score: number | null;
  ai_analysis: ResumeAiAnalysis | null;
  ai_match: Record<string, { score: number; reason: string; company_name: string }> | null;
  ai_error: string;
  ai_analyzed_at: string | null;
  ats_viewed_at: string | null;
  limits?: ResumeLimits;
  created_at: string;
  updated_at: string;
}

export interface RebuiltSections {
  summary: string;
  skills: string[];
  experience: string;
  projects: string;
  education: string;
}

export interface ResumeWorkspace {
  id: number;
  file_name: string;
  file_size: number;
  cloudinary_url: string;
  public_id: string;
  is_missing: boolean;
  ai_status: "PENDING" | "COMPLETE" | "FAILED";
  ai_score: number | null;
  ai_analysis: ResumeAiAnalysis | null;
  ai_error: string;
  ai_analyzed_at: string | null;
  rebuilt_sections: RebuiltSections | null;
  rebuilt_text: string;
  rebuilt_file_name: string;
  rebuilt_docx_url: string;
  rebuilt_tex: string;
  rebuilt_pdf_url: string;
  rebuilt_at: string | null;
  rebuilt_ai_status: "PENDING" | "COMPLETE" | "FAILED";
  rebuilt_ai_score: number | null;
  rebuilt_ai_analysis: ResumeAiAnalysis | null;
  rebuilt_ai_error: string;
  rebuilt_ai_analyzed_at: string | null;
  source_ai_status: "PENDING" | "COMPLETE" | "FAILED";
  source_ai_score: number | null;
  source_ai_analysis: ResumeAiAnalysis | null;
  source_ai_error: string;
  source_ai_analyzed_at: string | null;
  owner_name: string;
  resume_source: string;
  rebuild_requirements: string;
  created_at: string;
  updated_at: string;
}

export interface AiAccessConfig {
  id: number;
  student: number;
  daily_ai_requests: number | null;
  unlimited_ai: boolean;
  ats_view_interval_days: number | null;
  daily_resume_uploads: number | null;
  effective: {
    daily_ai_requests: number;
    ai_review_window_days: number;
    ats_view_interval_days: number | null;
    daily_resume_uploads: number;
    resume_upload_window_days: number;
    unlimited_ai: boolean;
  };
  ai_requests_used: number;
  resume_uploads_used: number;
  /** When the next AI review slot opens (ISO) - null when a review is available now. */
  next_ai_review_at: string | null;
  updated_at: string;
}

export interface StudentStatusRow {
  student_id: number;
  roll_number: string;
  full_name: string;
  role?: string;
  avatar_url?: string;
  gender_label?: string;
  branch_name: string | null;
  branch_code: string;
  section_name: string | null;
  passout_year: number | null;
  has_resume: boolean;
  is_reviewed: boolean;
  resume_id: number | null;
  file_name: string | null;
  updated_at: string | null;
  ai_status: "PENDING" | "COMPLETE" | "FAILED" | null;
  /** 0-100 AI ATS score - null when not analyzed. */
  ai_score: number | null;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped_errors: { row: number; roll_number?: string; error: string }[];
}

export type NotificationKind =
  | "DOCUMENT_UPLOAD"
  | "RESUME_UPLOAD"
  | "CONTACT_ADMIN"
  | "ANNOUNCEMENT"
  | "DRIVE"
  | "AI_RESUME";

export interface Notification {
  id: number;
  kind: NotificationKind;
  kind_label: string;
  title: string;
  message: string;
  link: string;
  read: boolean;
  created_at: string;
}

export type ContactRequestStatus = "PENDING" | "RESOLVED";

export interface ContactRequest {
  id: number;
  sender: number;
  sender_name: string;
  sender_roll: string;
  sender_role: string;
  subject: string;
  message: string;
  status: ContactRequestStatus;
  status_label: string;
  created_at: string;
  resolved_at: string | null;
}

export type ShareRequestStatus = "PENDING" | "ACCEPTED" | "DECLINED";

export interface AiUsageUser {
  user_id: number;
  name: string;
  roll_number: string;
  role: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  resume: {
    ai_status: "PENDING" | "COMPLETE" | "FAILED" | null;
    ai_score: number | null;
    ai_analysis: {
      summary?: string;
      strengths?: string[];
      improvements?: string[];
      skills?: string[];
      ats_keywords?: string[];
    } | null;
    ai_match: Record<
      string,
      { score: number; reason: string; company_name: string }
    > | null;
    ai_error: string | null;
    ai_analyzed_at: string | null;
  } | null;
}

export interface AiDailyPoint {
  date: string;
  calls: number;
  tokens: number;
}

export interface AiUsageData {
  totals: {
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    used_tokens: number;
  };
  daily: AiDailyPoint[];
  per_user: AiUsageUser[];
  budget_tokens: number;
  remaining_tokens: number | null;
  percent_used: number | null;
}

export interface MyAiUsage {
  calls: number;
  used_tokens: number;
  credits: number;
  recent: {
    action: string;
    action_label: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    created_at: string;
  }[];
}

export type AiProviderType =
  | "OPENAI_COMPATIBLE"
  | "GEMINI"
  | "NVIDIA"
  | "RAG"
  | "GROQ"
  | "CEREBRAS"
  | "OPENROUTER"
  | "MISTRAL"
  | "DEEPSEEK"
  | "TOGETHER";

export type AiHealthStatus =
  | "HEALTHY"
  | "DEGRADED"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "DISABLED"
  | "UNKNOWN";

export interface AiProvider {
  id: number;
  name: string;
  provider_type: AiProviderType;
  provider_type_label: string;
  model: string;
  base_url: string;
  api_key_masked: string;
  extra_keys: { id: number; masked: string; note: string }[];
  priority: number;
  enabled: boolean;
  timeout_seconds: number;
  max_retries: number;
  purpose: string;
  health: AiHealthStatus;
  health_label: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_type: string;
  consecutive_failures: number;
  total_requests: number;
  total_errors: number;
  created_at: string;
  updated_at: string;
}

export interface AiProviderPayload {
  name?: string;
  provider_type?: AiProviderType;
  model?: string;
  base_url?: string;
  api_key?: string;
  priority?: number;
  enabled?: boolean;
  timeout_seconds?: number;
  max_retries?: number;
  purpose?: string;
}

export interface AiTaskConfig {
  id: number;
  task: string;
  task_label: string;
  primary: number | null;
  primary_name: string;
  fallback_1: number | null;
  fallback_1_name: string;
  fallback_2: number | null;
  fallback_2_name: string;
  fallback_3: number | null;
  fallback_3_name: string;
  updated_at: string;
}

export interface AiSettings {
  enable_ai: boolean;
  enable_fallback: boolean;
  enable_caching: boolean;
  enable_web_research: boolean;
  default_timeout_seconds: number;
  default_max_retries: number;
  maintenance_mode: boolean;
  log_retention_days: number;
  updated_at: string;
}

export interface AiProviderHealth {
  id: number;
  provider: number;
  provider_name: string;
  provider_type: string;
  status: AiHealthStatus;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_type: string;
  failure_count: number;
  success_count: number;
  last_used_at: string | null;
  updated_at: string;
}

export interface AiRequestLogRow {
  id: number;
  provider_used: string;
  primary_provider: string;
  task: string;
  user_name: string;
  user_roll: string;
  status: "SUCCESS" | "FAILED";
  status_label: string;
  fallback_used: boolean;
  error_type: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  created_at: string;
}

export interface AiUsageStats {
  totals: {
    calls: number;
    success: number;
    errors: number;
    prompt_tokens: number;
    completion_tokens: number;
    fallback_used: number;
  };
  by_provider: { provider_used: string; calls: number; errors: number }[];
  recent: AiRequestLogRow[];
}

export interface AiHealthReport {
  window_days: number;
  totals: {
    calls: number;
    success: number;
    errors: number;
    fallbacks: number;
    prompt_tokens: number;
    completion_tokens: number;
    estimated_cost: number;
  };
  top_error_types: { type: string; count: number }[];
  providers: Record<
    string,
    {
      calls: number;
      success: number;
      errors: number;
      uptime_pct: number;
      prompt_tokens: number;
      completion_tokens: number;
      estimated_cost: number;
    }
  >;
  empty?: boolean;
}

export interface Drive {
  id: number;
  company_name: string;
  job_type: "" | "JOB" | "INTERNSHIP";
  role: string;
  location: string;
  package: string;
  drive_link: string;
  description: string;
  eligibility: string;
  eligible_roll_numbers: string;
  last_date_to_apply: string;
  posted_by: number | null;
  posted_by_name: string | null;
  posted_by_role: string | null;
  status: "OPEN" | "EXPIRED";
  expires_at: string | null;
  is_eligible_for_me: boolean | null;
  my_match: { score: number; reason: string } | null;
  created_at: string;
  updated_at: string;
}

export interface DriveChatMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface DocumentShareRequest {
  id: number;
  document: number;
  document_title: string;
  file_name: string;
  subject_name: string;
  category_name: string;
  semester_name: string;
  from_section: number;
  from_section_name: string;
  from_branch_name: string;
  from_branch_code: string;
  to_section: number;
  to_section_name: string;
  to_branch_code: string;
  requested_by: number | null;
  requested_by_name: string | null;
  requested_by_roll: string | null;
  status: ShareRequestStatus;
  status_label: string;
  note: string;
  created_at: string;
  responded_at: string | null;
}
