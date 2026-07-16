'use client'

import { useState } from 'react'
import { CatalogEditor, type CatalogItem } from '@/components/admin/CatalogEditor'

export function CatalogsClient({
  labor,
  materials,
}: {
  labor: CatalogItem[]
  materials: CatalogItem[]
}) {
  const [tab, setTab] = useState<'labor' | 'material'>('labor')

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-fg">Catalogs</h1>

      <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
        <button
          type="button"
          onClick={() => setTab('labor')}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${tab === 'labor' ? 'bg-primary-50 text-primary-700' : 'text-fg-muted'}`}
        >
          Labor categories
        </button>
        <button
          type="button"
          onClick={() => setTab('material')}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${tab === 'material' ? 'bg-primary-50 text-primary-700' : 'text-fg-muted'}`}
        >
          Materials
        </button>
      </div>

      {tab === 'labor' ? (
        <CatalogEditor kind="labor" initial={labor} />
      ) : (
        <CatalogEditor kind="material" initial={materials} />
      )}
    </div>
  )
}
