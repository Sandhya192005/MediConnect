import DashboardShell from "@/components/DashboardShell";

export default function AdminDashboard() {
  return (
    <DashboardShell
      role="admin"
      heading="Admin dashboard"
      cards={[
        { title: "Hospitals & departments", text: "Add and manage hospitals.", phase: "Phase 2" },
        { title: "Doctors", text: "Approve and manage doctors.", phase: "Phase 2" },
        { title: "Scrape jobs", text: "Hospitals fetched from the web.", phase: "Phase 7.5" },
      ]}
    />
  );
}
