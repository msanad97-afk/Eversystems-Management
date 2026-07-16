import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'

export function MaterialsTotalsTable({
  materials,
}: {
  materials: { materialName: string; unit: string; total: number }[]
}) {
  if (materials.length === 0) {
    return <EmptyState title="No material consumption" description="No materials recorded in this range." />
  }
  return (
    <Table>
      <THead>
        <TR>
          <TH>Material</TH>
          <TH className="text-right">Total</TH>
          <TH>Unit</TH>
        </TR>
      </THead>
      <TBody>
        {materials.map((m) => (
          <TR key={`${m.materialName}|${m.unit}`}>
            <TD>{m.materialName}</TD>
            <TD className="text-right tabular-nums">{m.total.toLocaleString()}</TD>
            <TD className="text-fg-muted">{m.unit}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  )
}
