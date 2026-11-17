export type Department = { id: number; name: string; description: string };

export type Hospital = {
  id: number;
  name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  phone: string;
  website: string;
  latitude: number | null;
  longitude: number | null;
  location_verified: boolean;
  departments: Department[];
  source: "manual" | "scraped";
  is_approved: boolean;
};

export type NearbyHospital = Hospital & {
  distance_km: number | null;
  doctor_count: number;
  is_partner: boolean;
  has_website: boolean;
  scraped_at: string | null;
};

export type NearbyResponse = {
  center: LatLng;
  radius_km: number;
  count: number;
  loading_more: boolean;
  results: NearbyHospital[];
  place?: { name: string; display_name: string; lat: number; lng: number };
};

export type ScrapeJob = {
  id: number;
  hospital: number | null;
  query: string;
  url: string;
  status: "pending" | "running" | "done" | "failed" | "blocked";
  status_label: string;
  message: string;
  pages_visited: number;
  created_at: string;
  finished_at: string | null;
};

export type ScrapedDoctor = {
  id: number;
  name: string;
  specialization: string;
  qualification: string;
  timings: string;
  source_url: string;
  collected_at: string;
};

export type HospitalDetail = Hospital & {
  source_url: string;
  scraped_at: string | null;
  booking_url: string;
  scraped_info: {
    phones: string[];
    emails: string[];
    opd_timings: string;
    departments: string[];
    notes: string;
    address: string;
  } | null;
  scraped_doctors: ScrapedDoctor[];
  is_fresh: boolean;
  has_bookable_doctors: boolean;
  active_job: ScrapeJob | null;
  /** Where the website came from: "osm" | "wikidata" | "patient" | "nearby" | "" (admin / the hospital). */
  website_source: string;
  /** No website saved and we haven't searched for one recently. */
  can_search_website: boolean;
};

export type AppointmentRequest = {
  id: number;
  hospital: number;
  hospital_name: string;
  hospital_phone: string;
  scraped_doctor: number | null;
  doctor_name: string | null;
  preferred_date: string;
  preferred_time: string;
  reason: string;
  phone: string;
  status: "pending" | "confirmed" | "declined" | "cancelled";
  status_label: string;
  admin_note: string;
  patient_email: string;
  created_at: string;
};

export type ExternalAppointment = {
  id: number;
  hospital: number | null;
  hospital_name: string;
  display_hospital: string;
  doctor_name: string;
  start: string;
  booking_reference: string;
  notes: string;
  status: "upcoming" | "cancelled";
  label: string;
  created_at: string;
};

export function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

export type LatLng = { lat: number; lng: number };

export type Availability = {
  id?: number;
  weekday: number;
  weekday_name?: string;
  start_time: string;
  end_time: string;
};

export type Doctor = {
  id: number;
  name: string;
  email: string;
  hospital: number | null;
  hospital_name: string | null;
  hospital_city: string | null;
  department: number | null;
  department_name: string | null;
  specialization: string;
  qualification: string;
  experience_years: number;
  fee: string;
  bio: string;
  slot_minutes: number;
  is_bookable: boolean;
  availability: Availability[];
};

export type Slot = { start: string; end: string; available: boolean };

export type AppointmentStatus = "booked" | "confirmed" | "cancelled" | "completed";

export type Appointment = {
  id: number;
  doctor: number;
  doctor_name: string;
  specialization: string;
  hospital_name: string | null;
  patient_name: string;
  patient_email: string;
  start: string;
  end: string;
  status: AppointmentStatus;
  reason: string;
  cancelled_by: string;
  /** The patient's ID (for the doctor, to open their records). */
  patient_id: string | null;
  // Patient queue (Step 3)
  queue_status: QueueStatus;
  token: number | null;
  checked_in_at: string | null;
  consultation_started_at: string | null;
  /** Waiting patients only: how many are ahead of them. */
  people_ahead: number | null;
};

export type QueueStatus = "not_arrived" | "waiting" | "in_consultation" | "done" | "cancelled";

export type DoctorQueue = {
  date: string;
  in_consultation: Appointment[];
  waiting: Appointment[];
  not_arrived: Appointment[];
  done: Appointment[];
};

export type RecordType = "lab_report" | "scan" | "xray" | "prescription" | "discharge" | "other";

export const RECORD_TYPES: { value: RecordType; label: string; icon: string }[] = [
  { value: "lab_report", label: "Lab report", icon: "activity" },
  { value: "scan", label: "Scan (CT / MRI / ultrasound)", icon: "brain" },
  { value: "xray", label: "X-ray", icon: "bone" },
  { value: "prescription", label: "Prescription", icon: "file" },
  { value: "discharge", label: "Discharge summary", icon: "hospital" },
  { value: "other", label: "Other", icon: "folder" },
];

export type MedicalRecord = {
  id: number;
  title: string;
  record_type: RecordType;
  record_type_label: string;
  record_date: string | null;
  notes: string;
  original_name: string;
  content_type: string;
  size: number;
  created_at: string;
};

export type RecordAccess = {
  id: number;
  viewer_name: string;
  hospital_name: string;
  record_title: string;
  action: "view_list" | "download";
  action_label: string;
  created_at: string;
};

export type PatientLookup = {
  patient: { patient_id: string; name: string };
  hospital: string;
  records: MedicalRecord[];
};

export const fmtSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export const fmtDate = (iso: string) =>
  new Date(`${iso.length === 10 ? `${iso}T00:00` : iso}`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export const WEEKDAYS =["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** YYYY-MM-DD in the user's local time zone. */
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
