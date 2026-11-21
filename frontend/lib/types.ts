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

/** Where a hospital is, for directions and a small map (latitude null = no pin yet). */
export type HospitalPlaceData = {
  id: number; address: string; city: string; phone: string;
  latitude: number | null; longitude: number | null; location_verified: boolean;
};

export type AppointmentRequest = {
  id: number;
  hospital: number;
  hospital_name: string;
  hospital_phone: string;
  hospital_place: HospitalPlaceData | null;
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
  /** null when the hospital was typed in by hand (directions then search its name). */
  hospital_place: HospitalPlaceData | null;
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

/** no_show = the patient didn't come, marked by the doctor or hospital (2026-11-20). */
export type AppointmentStatus = "booked" | "confirmed" | "cancelled" | "completed" | "no_show";

export type Appointment = {
  id: number;
  doctor: number;
  doctor_name: string;
  specialization: string;
  hospital_name: string | null;
  /** Where to go: the hospital's address and map pin. */
  hospital: HospitalPlaceData | null;
  /** This visit's treatment note id, if the doctor wrote one. */
  treatment_note: number | null;
  patient_name: string;
  patient_email: string;
  start: string;
  end: string;
  status: AppointmentStatus;
  reason: string;
  cancelled_by: string;
  /** Why the hospital declined (cancelled_by "hospital"). */
  cancel_reason: string;
  /** Booked but waiting for the hospital's Confirm: the slot is held, the doctor doesn't see it yet. */
  awaiting_hospital: boolean;
  /** When the patient booked. */
  created_at: string;
  /** The patient's ID (for the doctor, to open their records). */
  patient_id: string | null;
  // Patient queue (Step 3)
  queue_status: QueueStatus;
  token: number | null;
  checked_in_at: string | null;
  consultation_started_at: string | null;
  /** Waiting patients only: how many are ahead of them. */
  people_ahead: number | null;
  // No-show (2026-11-20): who marked it, and whether this viewer may mark it / undo it (server rules).
  no_show_by: string;
  can_mark_no_show: boolean;
  can_undo_no_show: boolean;
  // Booking flow (2026-11-21): personal request (to the doctor) or hospital request (hospital assigns).
  source: "personal" | "hospital";
  /** Given to the doctor, waiting for their Accept / Reject. */
  awaiting_doctor: boolean;
  /** The newest doctor rejection (the hospital sees who said no and why). */
  last_rejection: { doctor_name: string; reason: string; at: string } | null;
};

/** A doctor the hospital can assign a request to (GET /api/appointments/<id>/assignable-doctors/). */
export type AssignableDoctor = {
  id: number; name: string; specialization: string; department: string;
  chosen_by_patient: boolean; free: boolean; rejected: boolean;
};

/** One doctor's appointments for the hospital's Doctor management page. */
export type DoctorAppointments = {
  doctor: { id: number; name: string; specialization: string; department: string; email: string; is_bookable: boolean };
  counts: { waiting: number; accepted: number; rejected: number };
  waiting: Appointment[];
  accepted: Appointment[];
  rejected: { id: number; reason: string; at: string; appointment: number; start: string; patient_name: string;
              patient_id: string | null; now_with: string; status: AppointmentStatus }[];
};

export type QueueStatus = "not_arrived" | "waiting" | "in_consultation" | "done" | "cancelled" | "no_show";

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
  /** "doctor", "hospital" (a hospital account) or "admin" (the platform admin). Older entries by hospitals say "admin". */
  viewer_role: "doctor" | "hospital" | "admin";
  hospital_name: string;
  record_title: string;
  action: "view_list" | "download";
  action_label: string;
  created_at: string;
};

/** A patient's details and health details: their own (Profile & settings) or, read-only, for doctors and admins. */
export type PatientDetails = {
  patient_id: string;
  date_of_birth: string | null;
  gender: "" | "female" | "male" | "other";
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  weight_updated_on: string | null;
  bmi: number | null;
  blood_group: "" | "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-" | "unknown";
  allergies: string;
  no_known_allergies: boolean;
  conditions: ConditionKey[];
  conditions_other: string;
  no_conditions: boolean;
  current_medicines: string;
  no_current_medicines: boolean;
  emergency_contact_name: string;
  emergency_contact_relation: string;
  emergency_contact_phone: string;
  health_updated_at: string | null;
  /** Percent of the questions answered ("none" counts as an answer). */
  completeness: number;
};

/** Same keys as PatientProfile.CONDITIONS on the server. */
export const CONDITIONS = {
  diabetes: "Diabetes",
  high_bp: "High blood pressure",
  asthma: "Asthma",
  thyroid: "Thyroid problem",
  heart: "Heart disease",
  kidney: "Kidney disease",
} as const;
export type ConditionKey = keyof typeof CONDITIONS;

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
/** "A-" is stored with a plain hyphen; shown with a real minus sign. */
export const bloodGroupLabel = (g: PatientDetails["blood_group"]) => (g === "unknown" ? "Don't know" : g.replace("-", "−"));

/** BMI bands (WHO adult cut-offs). */
export function bmiBand(bmi: number): string {
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "healthy range";
  if (bmi < 30) return "overweight";
  return "obese range";
}

/** One medicine on a treatment note. */
export type Medicine = { name: string; dose: string; frequency: string; days: number | null };

/** A doctor's notes for one visit (reference design, Part 3). Read by the patient and any doctor. */
export type TreatmentNote = {
  id: number;
  appointment: number;
  visit_start: string;
  doctor_name: string;
  hospital_name: string;
  diagnosis: string;
  medicines: Medicine[];
  advice: string;
  follow_up_on: string | null;
  created_at: string;
  updated_at: string;
  edited: boolean;
};

export type PatientLookup = {
  patient: { patient_id: string; name: string };
  details: PatientDetails;
  /** Treatment notes from every doctor, newest first. */
  notes: TreatmentNote[];
  /** The viewer's own hospital (null if they have none). */
  hospital: string | null;
  records: MedicalRecord[];
};

export const fmtSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export const fmtDate = (iso: string) =>
  new Date(`${iso.length === 10 ? `${iso}T00:00` : iso}`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

// ---- Hospital admin (Step 4) ----

/** Other hospital staff (owner request 2026-11-18); same keys as StaffMember.Kind on the server. */
export const OTHER_STAFF_KINDS = {
  lab_technician: "Lab technician",
  pharmacist: "Pharmacist",
  receptionist: "Receptionist",
  office: "Office / admin staff",
  housekeeping: "Housekeeping",
  security: "Security",
  other: "Other",
} as const;
export type OtherStaffKind = keyof typeof OTHER_STAFF_KINDS;
export type StaffKind = "doctor" | "nurse" | OtherStaffKind;

export type StaffMember = {
  id: number;
  kind: StaffKind;
  kind_label: string;
  full_name: string;
  doctor: number | null;
  doctor_email: string | null;
  department: number | null;
  department_name: string | null;
  designation: string;
  phone: string;
  email: string;
  join_date: string;
  left_on: string | null;
  monthly_salary: string;
  is_active: boolean;
  created_at: string;
};

/** A hospital's request to connect with MediConnect (GET /api/hospital-admin/connection/, /api/platform/connection-requests/). */
export type ConnectionRequest = {
  id: number;
  hospital: number;
  hospital_name: string;
  hospital_city: string;
  hospital_address: string;
  hospital_phone: string;
  hospital_source: string;
  requested_by_email: string | null;
  message: string;
  status: "pending" | "approved" | "declined" | "disconnected";
  status_label: string;
  admin_note: string;
  decided_at: string | null;
  created_at: string;
  staff_count: number;
  doctor_count: number;
};

export type HospitalConnection = {
  connected: boolean;
  hospital: { name: string; city: string; address: string; phone: string };
  request: ConnectionRequest | null;
};
/** One month of the hospital's payroll (GET /api/hospital-admin/payroll/). Money values are rupees. */
export type PayrollMonth = { month: string; people: number; doctors: number | string; nurses: number | string; other_staff: number | string; total: number | string };

export type DoctorAccount = { id: number; name: string; email: string; specialization: string; department: number | null };

export type StaffChartPoint = { month: string; doctors: number; nurses: number };

export type Trend = { now: number; before: number; change_pct: number | null };

export type HospitalOverview = {
  /** connected = approved by MediConnect: patients can find and book it. Signed-up hospitals start unconnected. */
  hospital: { id: number; name: string; city: string; connected: boolean };
  counts: {
    doctors: number;
    nurses: number;
    other_staff: number;
    patients: number;
    appointments_today: number;
    /** Bookings waiting for the hospital's Confirm. */
    to_confirm: number;
    /** Requests given to doctors, waiting for their Accept / Reject (booking flow, 2026-11-21). */
    waiting_for_doctors: number;
    waiting_now: number;
    doctor_accounts_without_record: number;
  };
  payroll: { monthly_total: string | number; doctors: string | number; nurses: string | number; other_staff: string | number };
  staff_chart: StaffChartPoint[];
  /** % change per card (2026-11-21); change_pct null = nothing to compare with yet. */
  trends: Record<"doctors" | "nurses" | "other_staff" | "patients" | "appointments_today", Trend>;
  recent_activity: { kind: "staff" | "booking"; title: string; detail: string; at: string }[];
};

export type HospitalPatient = {
  patient_id: string | null;
  name: string;
  email: string;
  phone: string;
  visits: number;
  last_visit: string | null;
  next_visit: string | null;
  records: number;
};

// ---- Platform analytics (platform admin) ----

export type Growth = { total: number; new_this_month: number; change_pct: number | null };

export type PlatformOverview = {
  /** Hospitals that run their management (staff, patient records) on MediConnect: they have a Hospital login. */
  hospital_accounts: Growth & { with_staff_records: number };
  patients: Growth;
  doctors: Growth;
  hospitals: Growth & { bookable: number; listed_not_connected: number };
  appointments: { this_month: number; change_pct: number | null };
  activity: { months: string[]; active_patients: number[]; active_doctors: number[] };
  recent: { kind: "patient" | "doctor" | "hospital" | "hospital_account"; title: string; detail: string; at: string; estimated?: boolean }[];
};

export type PlatformReports = {
  months: string[];
  usage: Record<
    "new_patients" | "new_doctors" | "active_patients" | "active_doctors" | "appointments_booked" | "appointments_completed" | "records_uploaded" | "check_ins",
    number[]
  >;
  growth: Record<
    "new_hospitals" | "total_hospitals" | "new_hospital_accounts" | "total_hospital_accounts" | "total_patients" | "total_doctors",
    number[]
  >;
  hospitals: {
    id: number; name: string; city: string; connected_on: string | null; estimated: boolean;
    doctors: number; patients: number; appointments: number; appointments_30d: number;
    has_account: boolean; staff: number;
  }[];
};

/** One hospital's reports (/api/hospital-admin/reports/, 2026-11-20). Visits are counted by visit date. */
export type HospitalReports = {
  months: string[];
  appointments: { booked: number[]; completed: number[]; no_show: number[] };
  totals: {
    appointments: number; completed: number; no_show: number; upcoming: number;
    cancelled_by_patient: number; cancelled_by_doctor: number; declined_by_hospital: number;
  };
  patients: { new: number[]; returning: number[]; unique: number; new_total: number };
  doctors: { id: number; name: string; specialization: string; department: string; appointments: number; completed: number; cancelled: number; no_show: number; patients: number }[];
  departments: { name: string; doctors: number; appointments: number; completed: number; cancelled: number; no_show: number; patients: number }[];
};

/** ₹ in Indian grouping, no paise: 1250000 → "₹12,50,000". */
export const fmtRupees = (v: string | number) => `₹${Math.round(Number(v)).toLocaleString("en-IN")}`;

/** Short rupee amounts for chart axes, in the Indian system: ₹25k, ₹4.5L (lakh), ₹1.2Cr (crore). */
export function fmtRupeesShort(v: number): string {
  const short = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
  if (v >= 1e7) return `₹${short(v / 1e7)}Cr`;
  if (v >= 1e5) return `₹${short(v / 1e5)}L`;
  if (v >= 1e3) return `₹${short(v / 1e3)}k`;
  return `₹${Math.round(v)}`;
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** YYYY-MM-DD in the user's local time zone. */
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * The area to show for a hospital, e.g. "T. Nagar, Chennai": the last part of its address that's a name
 * (no digits, so never a postcode or house number; not the city itself), then the city.
 */
export function areaOf(h: { address?: string | null; city?: string | null }): string {
  const city = h.city ?? "";
  const parts = (h.address || "").split(",").map((p) => p.trim())
    .filter((p) => p && !/\d/.test(p) && p.toLowerCase() !== city.toLowerCase() && !/tamil nadu|india/i.test(p));
  const area = parts.at(-1);
  if (area && area.length <= 30) return city ? `${area}, ${city}` : area;
  return city || "Area not listed";
}
/** GET/PATCH /api/hospital-admin/profile/: the hospital account's own hospital (2026-11-20). */
export type HospitalProfile = {
  id: number;
  name: string;
  email: string; // the login: read-only
  address: string;
  city: string;
  state: string;
  phone: string;
  website: string;
  latitude: number | null;
  longitude: number | null;
  location_verified: boolean;
  departments: { id: number; name: string }[];
  connected: boolean;
};

/** GET /api/platform/connected-hospitals/: hospitals patients can see and book (platform admin, 2026-11-20). */
export type ConnectedHospital = {
  id: number;
  name: string;
  city: string;
  address: string;
  phone: string;
  source: string;
  approved_at: string | null;
  approved_at_estimated: boolean;
  account_emails: string[];
  doctor_count: number;
  has_pin: boolean;
};

/** GET /api/support/inbox/: a support message as the platform admin sees it (2026-11-20). */
export type SupportInboxItem = {
  id: number;
  topic: string;
  topic_label: string;
  subject: string;
  message: string;
  status: "open" | "answered" | "closed";
  status_label: string;
  reply: string;
  created_at: string;
  updated_at: string;
  sender_name: string;
  sender_email: string;
  sender_role: string;
};
