// Spanish NIF / NIE / CIF validation (official check-digit algorithms).
export function checkNif(raw: string) {
  const v = raw.toUpperCase().replace(/[\s.\-]/g, "");
  const L = "TRWAGMYFPDXBNJZSQVHLCKE";
  if (!v) return { ok: false, msg: "Enter a NIF, NIE or CIF." } as const;
  if (/^\d{8}[A-Z]$/.test(v))
    return L[parseInt(v.slice(0, 8), 10) % 23] === v[8]
      ? { ok: true, v, type: "dni", entity: "autonomo", label: "Personal NIF (DNI)" } as const
      : { ok: false, msg: "The letter doesn’t match the DNI number." } as const;
  if (/^[XYZ]\d{7}[A-Z]$/.test(v)) {
    const n = "XYZ".indexOf(v[0]) + v.slice(1, 8);
    return L[parseInt(n, 10) % 23] === v[8]
      ? { ok: true, v, type: "nie", entity: "autonomo", label: "NIE" } as const
      : { ok: false, msg: "The letter doesn’t match the NIE number." } as const;
  }
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(v)) {
    const d = v.slice(1, 8); let sum = 0;
    for (let i = 0; i < 7; i++) { const n = +d[i]; if (i % 2 === 0) { const x = n * 2; sum += Math.floor(x / 10) + (x % 10); } else sum += n; }
    const c = (10 - (sum % 10)) % 10;
    if (v[8] !== String(c) && v[8] !== "JABCDEFGHI"[c]) return { ok: false, msg: "The control character doesn’t match this CIF." } as const;
    const kinds: Record<string, [string, string]> = { A: ["other", "Sociedad Anónima (SA)"], B: ["sl", "Sociedad Limitada (SL)"], F: ["other", "Cooperative"], J: ["other", "Civil partnership"], E: ["other", "Comunidad de bienes"] };
    const k = kinds[v[0]] ?? ["other", "Company or organisation"];
    return { ok: true, v, type: "cif", entity: k[0], label: k[1] } as const;
  }
  return { ok: false, msg: "That doesn’t look like a Spanish NIF, NIE or CIF." } as const;
}
