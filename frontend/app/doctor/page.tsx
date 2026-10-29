import DashboardShell from "@/components/DashboardShell";

export default function DoctorDashboard() {
  return (
    <DashboardShell
      role="doctor"
      heading="Doctor dashboard"
      cards={[
        { title: "My availability", text: "Set your weekly working hours.", phase: "Phase 2" },
        { title: "Today's appointments", text: "Patients booked with you.", phase: "Phase 2" },
        { title: "Profile", text: "Specialization, hospital and fee.", phase: "Phase 2" },
      ]}
    />
  );
}
