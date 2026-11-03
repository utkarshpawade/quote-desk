import type { IsoDate } from "@/domain/calendar";
import type { RateRef, RateUnit } from "@/domain/costing/types";
import type { RateCategory } from "@/domain/rates/catalog";
import { resolveAt, type VersionLike } from "@/domain/rates/resolve";
import type { DbOrTx } from "@/server/db-client";
import { dateStr, isoStr, rateStr } from "@/server/dto";

/** A rate item with its full version history, ready for resolution on any date. */
export interface CatalogVersion extends VersionLike {
  note: string | null;
  createdAt: string;
  createdByName: string;
  voidReason: string | null;
}

export interface CatalogItem {
  id: string;
  category: RateCategory;
  code: string;
  name: string;
  unit: RateUnit;
  attributes: Record<string, unknown>;
  active: boolean;
  sortOrder: number;
  versions: CatalogVersion[];
}

export async function loadCatalog(
  db: DbOrTx,
  options: { categories?: RateCategory[]; includeInactive?: boolean } = {},
): Promise<CatalogItem[]> {
  const items = await db.rateItem.findMany({
    where: {
      ...(options.categories ? { category: { in: options.categories } } : {}),
      ...(options.includeInactive ? {} : { active: true }),
    },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    include: {
      versions: {
        orderBy: { effectiveFrom: "asc" },
        include: { createdBy: { select: { name: true } } },
      },
    },
  });
  return items.map((item) => ({
    id: item.id,
    category: item.category,
    code: item.code,
    name: item.name,
    unit: item.unit,
    attributes: (item.attributes ?? {}) as Record<string, unknown>,
    active: item.active,
    sortOrder: item.sortOrder,
    versions: item.versions.map((v) => ({
      id: v.id,
      effectiveFrom: dateStr(v.effectiveFrom),
      value: rateStr(v.value)!,
      voidedAt: isoStr(v.voidedAt),
      note: v.note,
      voidReason: v.voidReason,
      createdAt: isoStr(v.createdAt),
      createdByName: v.createdBy.name,
    })),
  }));
}

/** The item's rate on a date as a RateRef, or null when no version is in force. */
export function refAt(item: CatalogItem, date: IsoDate): RateRef | null {
  const v = resolveAt(item.versions, date);
  return v
    ? { versionId: v.id, itemId: item.id, code: item.code, name: item.name, unit: item.unit, value: v.value, effectiveFrom: v.effectiveFrom }
    : null;
}

/** The RateRef for a specific stored version id (whatever date it is in force). */
export function refForVersion(item: CatalogItem, versionId: string): RateRef | null {
  const v = item.versions.find((x) => x.id === versionId);
  return v
    ? { versionId: v.id, itemId: item.id, code: item.code, name: item.name, unit: item.unit, value: v.value, effectiveFrom: v.effectiveFrom }
    : null;
}

export class Catalog {
  readonly byId: Map<string, CatalogItem>;
  readonly byCode: Map<string, CatalogItem>;
  private readonly byVersion: Map<string, CatalogItem>;

  constructor(readonly items: CatalogItem[]) {
    this.byId = new Map(items.map((i) => [i.id, i]));
    this.byCode = new Map(items.map((i) => [i.code, i]));
    this.byVersion = new Map(items.flatMap((i) => i.versions.map((v) => [v.id, i] as const)));
  }

  static async load(db: DbOrTx) {
    return new Catalog(await loadCatalog(db, { includeInactive: true }));
  }

  refAt(itemId: string | null | undefined, date: IsoDate): RateRef | null {
    const item = itemId ? this.byId.get(itemId) : undefined;
    return item ? refAt(item, date) : null;
  }

  codeAt(code: string, date: IsoDate): RateRef | null {
    const item = this.byCode.get(code);
    return item ? refAt(item, date) : null;
  }

  version(versionId: string | null | undefined): RateRef | null {
    const item = versionId ? this.byVersion.get(versionId) : undefined;
    return item && versionId ? refForVersion(item, versionId) : null;
  }

  itemOfVersion(versionId: string | null | undefined): CatalogItem | null {
    return versionId ? (this.byVersion.get(versionId) ?? null) : null;
  }

  ofCategory(category: RateCategory, includeInactive = false): CatalogItem[] {
    return this.items.filter((i) => i.category === category && (includeInactive || i.active));
  }
}
