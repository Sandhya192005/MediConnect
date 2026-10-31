import DashboardShell from "@/components/DashboardShell";
import { API_URL } from "@/lib/api";

export default function AdminDashboard() {
  return (
    <DashboardShell
      role="admin"
      heading="Admin dashboard"
      cards={[
        { title: "Hospitals", text: "Add and approve hospitals.", href: "/admin/hospitals" },
        { title: "Doctors & appointments", text: "Full management in Django admin.", href: `${API_URL}/admin/` },
        { title: "Appointment requests", text: "Confirm or decline requests to non-partner hospitals.", href: "/admin/requests" },
        { title: "Scrape jobs", text: "Website lookups and their results (Django admin).", href: `${API_URL}/admin/scraper/scrapejob/` },
      ]}
    />
  );
}
