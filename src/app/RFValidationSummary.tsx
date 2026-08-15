import { ScientificValidationSummary } from '@jorpago2/scientific-ui/scientific-layout'
import { InlineNotification } from '@carbon/react'
import type { RFAnalysisSettings, SimulationOutput } from '../engine/types'
import type { GraphValidationResult } from '../engine/validation'

interface RFValidationSummaryProps {
  analysis: RFAnalysisSettings
  error: string | null
  graphValidation: GraphValidationResult | null
  modelRevision: number
  result: SimulationOutput | null
  resultRevision: number | null
}

export default function RFValidationSummary({
  analysis,
  error,
  graphValidation,
  modelRevision,
  result,
  resultRevision,
}: RFValidationSummaryProps) {
  const linearEvidence = result?.linearSolveEvidence
  const linearEvidencePassed = Boolean(
    linearEvidence?.available &&
      (linearEvidence.worstReciprocalConditionEstimate ?? 0) >= 1e-10 &&
      (linearEvidence.worstNormalizedResidual ?? Number.POSITIVE_INFINITY) <=
        1e-10,
  )
  return <>
    <ScientificValidationSummary
      title="RF model evidence"
      description="Structural validity and solver warnings are reported separately from successful execution."
      status={{
        state: error ? 'failed' : graphValidation === null ? 'ready' : !graphValidation.valid ? 'failed' : result?.warnings.length ? 'warning' : linearEvidencePassed ? 'validated' : result ? 'up-to-date' : 'ready',
        label: error ? 'Simulation stopped' : graphValidation === null ? 'Checking model' : !graphValidation.valid ? 'Model blocked' : result?.warnings.length ? 'Solved with warnings' : linearEvidencePassed ? 'Linear solve evidence passed' : result ? 'Single-run checks passed' : 'Ready to simulate',
      }}
      checks={[
        { id: 'topology', label: 'Source-to-load topology', state: graphValidation === null ? 'not-run' : graphValidation.valid ? 'passed' : 'failed', value: graphValidation === null ? 'Checking…' : graphValidation.valid ? 'Connected' : `${graphValidation.issues.length} issue(s)`, detail: graphValidation?.issues[0]?.message },
        { id: 'frequency', label: 'Frequency grid', state: analysis.stopHz > analysis.startHz && analysis.points >= 2 ? 'passed' : 'failed', value: `${analysis.points} points` },
        { id: 'result', label: 'Current result', state: result ? 'passed' : 'not-run', detail: result ? `Revision ${resultRevision}` : 'Run the current model before interpreting results.' },
        { id: 'condition', label: 'Linear-system reciprocal condition', state: !result || !linearEvidence?.available ? 'not-run' : (linearEvidence.worstReciprocalConditionEstimate ?? 0) >= 1e-10 ? 'passed' : 'warning', value: linearEvidence?.worstReciprocalConditionEstimate?.toExponential(3), detail: linearEvidence?.available ? `Worst case at ${linearEvidence.worstFrequencyHz?.toExponential(6)} Hz; required rcond ≥ 1e-10.` : 'No interconnected linear system was required.' },
        { id: 'residual', label: 'Normalized backward residual', state: !result || !linearEvidence?.available ? 'not-run' : (linearEvidence.worstNormalizedResidual ?? Number.POSITIVE_INFINITY) <= 1e-10 ? 'passed' : 'warning', value: linearEvidence?.worstNormalizedResidual?.toExponential(3), detail: 'Required normalized residual ≤ 1e-10.' },
        { id: 'warnings', label: 'Solver warnings', state: result ? result.warnings.length ? 'warning' : 'passed' : 'not-run', value: result ? result.warnings.length : undefined },
      ]}
    />
    <dl className="workflow-summary">
      <div><dt>Model revision</dt><dd>{modelRevision}</dd></div>
      <div><dt>Warnings</dt><dd>{result?.warnings.length ?? 0}</dd></div>
      <div><dt>Result</dt><dd>{result ? 'Current' : 'Not solved'}</dd></div>
    </dl>
    {error && (
      <InlineNotification className="workflow-notification" hideCloseButton kind="error" lowContrast title="Simulation stopped" subtitle={error} />
    )}
    {(result?.warnings.length ?? 0) > 0 && (
      <InlineNotification
        className="workflow-notification"
        hideCloseButton
        kind="warning"
        lowContrast
        title={`${result!.warnings.length} simulation ${result!.warnings.length === 1 ? 'warning' : 'warnings'}`}
      >
        <ul className="scientific-warning-list">
          {result!.warnings.map((warning, index) => (
            <li key={`${warning.code}-${warning.frequencyHz ?? index}`}>{warning.message}</li>
          ))}
        </ul>
      </InlineNotification>
    )}
  </>
}
