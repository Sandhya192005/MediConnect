import DashboardShell from "@/components/DashboardShell";

export default function PatientDashboard() {
  return (
    <DashboardShell
      role="patient"
      heading="Patient dashboard"
      cards={[
        { title: "Book an appointment", text: "Find a hospital or doctor, then pick a slot.", href: "/doctors" },
        { title: "My appointments", text: "Upcoming and past visits.", href: "/patient/appointments" },
        { title: "Hospitals near me", text: "Every hospital around you on a map.", href: "/hospitals" },
      ]}
    />
  );
}
