import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

/** Before all tests: reset the fixed test data in the Docker backend and save its ids for the tests. */
export default async function globalSetup() {
  const root = path.resolve(__dirname, "..");
  let out: string;
  try {
    out = execSync("docker compose exec -T backend python manage.py e2e_setup", { cwd: root, encoding: "utf8" });
  } catch (e) {
    throw new Error(
      "Couldn't prepare test data. Is Docker running with the backend up?\n" +
        "  docker compose up -d db redis elasticsearch mailpit mockhospital backend celery_worker celery_beat scraper_worker\n" +
        String(e),
    );
  }
  const json = out.trim().split("\n").pop() ?? "";
  JSON.parse(json); // fail early if the command printed something unexpected
  writeFileSync(path.join(__dirname, ".e2e-data.json"), json);
}
