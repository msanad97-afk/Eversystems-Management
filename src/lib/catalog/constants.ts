/**
 * A flat MEASURED activity (rates but no named sub-activities) stores its rates on a
 * single hidden sub-activity carrying this reserved name. It is never shown in any UI
 * and admins may not create a sub-activity with this name — see the catalog routes.
 * This keeps budget + (Phase C2) reporting on one code path at the sub-activity level.
 */
export const IMPLICIT_SUBACTIVITY_NAME = '__implicit__'
