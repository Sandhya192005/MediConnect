import DashboardShell from "@/components/DashboardShell";

export default function DoctorDashboard() {
  return (
    <DashboardShell
      role="doctor"
      heading="Doctor dashboard"
      cards={[
        { title: "My appointments", text: "Patients booked with you.", href: "/doctor/appointments" },
        { title: "My availability", text: "Set your weekly working hours.", href: "/doctor/availability" },
        { title: "Profile", text: "Hospital, specialization and fee.", href: "/doctor/profile" },
      ]}
    />
  );
}
