"use client";

/** A tick box that ticks or clears every row box (`name="ids"`) of one list; the row boxes belong to the list's bulk form. */
export function SelectAll({ form, label }: { form: string; label: string }) {
  return (
    <label className="inline">
      <input
        type="checkbox"
        onChange={(e) => {
          const on = e.currentTarget.checked;
          document.querySelectorAll<HTMLInputElement>(`input[name="ids"][form="${form}"]`).forEach((b) => { b.checked = on; });
        }}
      />
      {label}
    </label>
  );
}
