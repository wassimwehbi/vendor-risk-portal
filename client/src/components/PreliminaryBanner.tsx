export function PreliminaryBanner() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span aria-hidden="true" className="mt-0.5 text-lg leading-none">
        ⚠️
      </span>
      <p>
        <span className="font-semibold">AI output is preliminary.</span> Classifications, mappings, risk levels and
        follow-ups are AI-assisted suggestions to accelerate review. The final vendor-risk decision is made by a human
        analyst — never automatically by the AI.
      </p>
    </div>
  );
}
