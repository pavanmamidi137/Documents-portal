export type Role = "SUPER_ADMIN" | "CR" | "FACULTY" | "STUDENT";

export interface User {
  id: number;
  roll_number: string;
  full_name: string;
  email: string | null;
  phone: string;
  role: Role;
  role_label: string;
  branch: number | null;
  branch_name: string | null;
  section: number | null;
  section_name: string | null;
  is_active: boolean;
  is_super_admin: boolean;
  is_cr: boolean;
  is_faculty: boolean;
  is_student: boolean;
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
  documents_count: number;
  created_at: string;
}

export interface DocumentItem {
  id: number;
  title: string;
  description: string;
  file_name: string;
  file_size: number;
  cloudinary_url: string;
  download_url: string;
  downloads: number;
  created_at: string;
  branch: number;
  branch_name: string;
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
}

export interface SearchResults {
  students: User[];
  documents: DocumentItem[];
  announcements: Announcement[];
}

export interface ResumeAiAnalysis {
  summary: string;
  strengths: string[];
  improvements: string[];
  skills: string[];
  ats_keywords: string[];
}

export interface Resume {
  id: number;
  student: number;
  student_roll: string;
  student_name: string;
  branch_name: string | null;
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
  created_at: string;
  updated_at: string;
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

export interface Drive {
  id: number;
  company_name: string;
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
  to_section: number;
  to_section_name: string;
  requested_by: number | null;
  requested_by_name: string | null;
  requested_by_roll: string | null;
  status: ShareRequestStatus;
  status_label: string;
  note: string;
  created_at: string;
  responded_at: string | null;
}
