import { annualSaving, paybackYears } from "./calculations";
import { seedEcms, seedProperties } from "./seed";
import type { Ecm, EcmInput, EcmStatus, PortfolioSummary, Property } from "./types";

let memoryProperties: Property[] = [...seedProperties];
let memoryEcms: Ecm[] = [...seedEcms];
let nextEcmId = Math.max(...memoryEcms.map((ecm) => ecm.id), 0) + 1;

async function postgresSql() {
  if (!process.env.POSTGRES_URL) return null;
  const mod = await import("@vercel/postgres");
  return mod.sql;
}

function enrichEcm(ecm: Ecm, properties = memoryProperties): Ecm {
  const property = properties.find((item) => item.id === ecm.property_id);
  const annual = property ? annualSaving(ecm, property) : ecm.annual_saving_eur;
  return {
    ...ecm,
    property_name: property?.name ?? ecm.property_name,
    annual_saving_eur: annual,
    simple_payback_years: paybackYears(ecm.investment_eur, annual)
  };
}

export async function listProperties(): Promise<Property[]> {
  const sql = await postgresSql();
  if (!sql) return memoryProperties;

  const result = await sql<Property>`SELECT * FROM properties ORDER BY name`;
  return result.rows;
}

export async function listEcms(propertyId?: number): Promise<Ecm[]> {
  const sql = await postgresSql();
  if (!sql) {
    return memoryEcms
      .filter((ecm) => !propertyId || ecm.property_id === propertyId)
      .map((ecm) => enrichEcm(ecm));
  }

  const result = propertyId
    ? await sql<Ecm>`
        SELECT e.*, p.name AS property_name
        FROM ecms e
        JOIN properties p ON p.id = e.property_id
        WHERE e.property_id = ${propertyId}
        ORDER BY p.name, e.status, e.ref, e.title
      `
    : await sql<Ecm>`
        SELECT e.*, p.name AS property_name
        FROM ecms e
        JOIN properties p ON p.id = e.property_id
        ORDER BY p.name, e.status, e.ref, e.title
      `;

  const properties = await listProperties();
  return result.rows.map((ecm) => enrichEcm(ecm, properties));
}

export async function createEcm(input: EcmInput): Promise<Ecm> {
  const sql = await postgresSql();
  if (!sql) {
    const ecm = enrichEcm({
      id: nextEcmId++,
      ...input,
      property_name: memoryProperties.find((item) => item.id === input.property_id)?.name,
      annual_saving_eur: 0,
      simple_payback_years: null
    });
    memoryEcms = [...memoryEcms, ecm];
    return ecm;
  }

  const result = await sql<Ecm>`
    INSERT INTO ecms (
      property_id, ref, title, status, approved, utility_type,
      investment_eur, energy_saving_kwh, what_why, pitfall, action, notes
    )
    VALUES (
      ${input.property_id}, ${input.ref}, ${input.title}, ${input.status}, ${input.approved},
      ${input.utility_type}, ${input.investment_eur}, ${input.energy_saving_kwh},
      ${input.what_why}, ${input.pitfall}, ${input.action}, ${input.notes}
    )
    RETURNING *
  `;
  const properties = await listProperties();
  return enrichEcm(result.rows[0], properties);
}

export async function updateEcmStatus(id: number, status: EcmStatus, approved: boolean): Promise<Ecm | null> {
  const sql = await postgresSql();
  if (!sql) {
    let updated: Ecm | null = null;
    memoryEcms = memoryEcms.map((ecm) => {
      if (ecm.id !== id) return ecm;
      updated = enrichEcm({ ...ecm, status, approved });
      return updated;
    });
    return updated;
  }

  const result = await sql<Ecm>`
    UPDATE ecms
    SET status = ${status}, approved = ${approved}, updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  if (!result.rows[0]) return null;
  const properties = await listProperties();
  return enrichEcm(result.rows[0], properties);
}

export async function deleteEcm(id: number): Promise<boolean> {
  const sql = await postgresSql();
  if (!sql) {
    const before = memoryEcms.length;
    memoryEcms = memoryEcms.filter((ecm) => ecm.id !== id);
    return memoryEcms.length !== before;
  }

  const result = await sql`DELETE FROM ecms WHERE id = ${id}`;
  return (result.rowCount ?? 0) > 0;
}

export async function portfolioSummary(propertyId?: number): Promise<PortfolioSummary> {
  const properties = await listProperties();
  const ecms = await listEcms(propertyId);
  const open = ecms.filter((ecm) => ecm.status === "Open");
  const implemented = ecms.filter((ecm) => ecm.status === "Implemented");

  return {
    properties: propertyId ? 1 : properties.length,
    ecms: ecms.length,
    open: open.length,
    implemented: implemented.length,
    openAnnualSaving: open.reduce((sum, ecm) => sum + ecm.annual_saving_eur, 0),
    implementedAnnualSaving: implemented.reduce((sum, ecm) => sum + ecm.annual_saving_eur, 0),
    totalEnergySaving: ecms.reduce((sum, ecm) => sum + (ecm.energy_saving_kwh ?? 0), 0)
  };
}
