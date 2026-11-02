import Link from "next/link";
import { notFound } from "next/navigation";
import { getT, type Key } from "@/lib/i18n";
import { getData } from "@/lib/data";
import { readServices, servicesKey } from "@/lib/services";
import { readSuite, testsKey } from "@/lib/agent-tests";
import { PARTS, type PartId } from "@/lib/client-transfer-parts";
import { ExportCard, ImportCard, type TransferLabels } from "@/components/ClientTransfer";
import { PageHead } from "@/components/ui";

const LABELS = [
  "export.title", "export.help", "all", "none", "photos", "download", "never", "customersWarn", "import.title", "import.help", "file", "bad.format", "bad.version",
  "bad.read", "from", "mode", "mode.merge", "mode.replace", "replaceNote", "confirm", "photosImport", "signinsNote", "syncNote", "import", "running",
  "nothing", "step.settings", "stepList", "step.finish", "result", "skipped", "done", "failed",
  "live", "fromLive", "fromStored", "renameTitle", "oldNames", "oldNamesHelp", "newName", "newNameAr", "renamedCount", "sync.ok", "sync.voiceMode",
  "sync.voiceModeUnknown", "sync.voiceModeFailed", "sync.no_agent", "sync.connected", "sync.no_api_key", "sync.no_secret", "sync.bad_secret", "sync.no_app_url", "sync.failed",
  "group.assistant", "group.content", "group.team", "group.setup", "group.people",
];

/** Admin Clients > Import/Export: one client's settings to a file and back (lib/client-transfer.ts). */
export default async function ClientTransfer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getData();
  const tenant = await d.getTenant(id);
  if (!tenant) notFound();
  const [{ t, locale }, knowledge, doctors, items, tables, customers, profiles, services, tests] = await Promise.all([
    getT(tenant), d.getKnowledge(id), d.getDoctors(id), d.getItems(id), d.getDataTables(id), d.getCustomers(id), d.listProfiles(id),
    d.getSetting(servicesKey(id)), d.getSetting(testsKey(id)),
  ]);
  const L: TransferLabels = Object.fromEntries([...LABELS, ...PARTS.map((p) => `part.${p}`)].map((k) => [k, t(`xfer.${k}` as Key)]));
  const counts: Partial<Record<PartId, number>> = {
    knowledge: knowledge.length, team: doctors.length, catalogue: items.length, tables: tables.length, customers: customers.length,
    signins: profiles.length, services: readServices(services).length, tests: readSuite(tests).tests.length,
  };
  const name = locale === "ar" ? tenant.branding.displayNameAr || tenant.name : tenant.branding.displayName || tenant.name;
  return (
    <>
      <PageHead title={`${t("xfer.title")}: ${name}`} actions={<Link className="btn ghost" href={`/admin/clients/${id}`}>{t("common.back")}</Link>} />
      <div className="xfer-cards">
        <ExportCard tenantId={id} L={L} counts={counts} />
        <ImportCard tenantId={id} tenantName={name} nameEn={tenant.branding.displayName || tenant.name} nameAr={tenant.branding.displayNameAr || ""} L={L} />
      </div>
    </>
  );
}
