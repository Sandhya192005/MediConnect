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

export type NearbyHospital = Hospital & { distance_km: number | null; doctor_count: number };

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
};

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** YYYY-MM-DD in the user's local time zone. */
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
