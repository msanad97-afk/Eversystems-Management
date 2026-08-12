'use client'

import { useState } from 'react'
import { CatalogEditor, type CatalogItem, type SupplierOption } from '@/components/admin/CatalogEditor'
import { CatalogActivityManager, type LaborOption, type MaterialOption } from '@/components/admin/CatalogActivityManager'
import { SupplierEditor, type SupplierItem } from '@/components/admin/SupplierEditor'
import type { CatalogActivityDTO } from '@/lib/catalog/payload'

type Tab = 'labor' | 'material' | 'activity' | 'supplier'

export function CatalogsClient({
  labor,
  materials,
  activities,
  laborOptions,
  materialOptions,
  suppliers,
  supplierOptions,
}: {
  labor: CatalogItem[]
  materials: CatalogItem[]
  activities: CatalogActivityDTO[]
  laborOptions: LaborOption[]
  materialOptions: MaterialOption[]
  suppliers: SupplierItem[]
  supplierOptions: SupplierOption[]
}) {
  const [tab, setTab] = useState<Tab>('activity')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'activity', label: 'Activities' },
    { key: 'labor', label: 'Labor categories' },
    { key: 'material', label: 'Materials' },
    { key: 'supplier', label: 'Suppliers' },
  ]

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-fg">Catalogs</h1>

      <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${tab === t.key ? 'bg-primary-50 text-primary-700' : 'text-fg-muted'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'activity' && (
        <CatalogActivityManager initial={activities} laborOptions={laborOptions} materialOptions={materialOptions} />
      )}
      {tab === 'labor' && <CatalogEditor kind="labor" initial={labor} />}
      {tab === 'material' && <CatalogEditor kind="material" initial={materials} supplierOptions={supplierOptions} />}
      {tab === 'supplier' && <SupplierEditor initial={suppliers} />}
    </div>
  )
}
