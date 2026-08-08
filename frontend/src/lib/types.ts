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
  created_at: string;
  updated_at: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped_errors: { row: number; roll_number?: string; error: string }[];
}

export type ShareRequestStatus = "PENDING" | "ACCEPTED" | "DECLINED";

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
