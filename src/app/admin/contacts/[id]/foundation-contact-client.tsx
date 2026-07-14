"use client";

import { useEffect, useState } from "react";
import { ContactTagsPanel } from "@/components/contact-tags-panel";

type Field = { id: string; name: string; fieldType: string; options: string[] };

export function FoundationContactClient({ contactId }: { contactId: string }) {
  const [fields, setFields] = useState<Field[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetch("/api/milestone3/foundation?resource=fields")
      .then((response) => response.json())
      .then((data: { fields?: Field[] }) => setFields(data.fields ?? []));
  }, [contactId]);

  async function setValue(field: Field, value: unknown) {
    const response = await fetch("/api/milestone3/foundation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "field_value", contactId, fieldId: field.id, value })
    });
    const data = await response.json() as { error?: string };
    setMessage(data.error || `${field.name}を更新しました。`);
  }

  return (
    <section className="mt-6 grid gap-6 md:grid-cols-2">
      <div className="rounded-xl border border-line bg-white p-6"><ContactTagsPanel contactId={contactId} /></div>
      <div className="rounded-xl border border-line bg-white p-6">
        <h2 className="font-black">カスタム項目</h2>
        <p className="mt-1 text-xs text-ink/45">顧客固有の補足情報を保存します。</p>
        <div className="mt-4 grid gap-3">
          {fields.map((field) => <label key={field.id} className="grid gap-1 text-xs font-bold">{field.name}<input onBlur={(event) => void setValue(field, event.currentTarget.value)} placeholder={field.fieldType} className="focus-ring min-h-10 rounded-lg border border-line px-3 text-sm font-normal" /></label>)}
          {!fields.length ? <p className="py-4 text-xs text-ink/40">カスタム項目はまだありません。</p> : null}
        </div>
        {message ? <p className="mt-3 text-xs font-bold text-moss">{message}</p> : null}
      </div>
    </section>
  );
}
