/** Makes it clear when a hospital's pin hasn't been checked by an admin. */
export default function LocationBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-800">Verified location</span>
  ) : (
    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800" title="This pin hasn't been verified yet. Confirm the address with the hospital.">
      Approximate location
    </span>
  );
}
