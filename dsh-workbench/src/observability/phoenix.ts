import { withSpan } from '@arizeai/openinference-core'
import { register } from '@arizeai/phoenix-otel'

export interface ModelTraceInput {
  provider: string
  model: string
  prompt: string
  maxTokens: number
  temperature: number
  rowCount: number
  fieldCount: number
}

export interface WorkbenchTracer {
  traceModelCall(input: ModelTraceInput, operation: () => Promise<string>): Promise<string>
  shutdown(): Promise<void>
}

type TraceProvider = { shutdown?: () => Promise<void> }

/**
 * The tracer is deliberately host-side: Phoenix credentials never cross into
 * the browser workbench or static dashboard files. It is opt-in so a missing
 * collector cannot block dashboard generation.
 */
export function createWorkbenchTracer(environment: NodeJS.ProcessEnv = process.env): WorkbenchTracer {
  if (environment.PHOENIX_ENABLED !== 'true') return noOpTracer()
  try {
    const provider = register({
      projectName: environment.PHOENIX_PROJECT || 'dsh-workbench',
      url: environment.PHOENIX_COLLECTOR_ENDPOINT || 'http://127.0.0.1:6006',
      apiKey: environment.PHOENIX_API_KEY,
      batch: true,
    }) as TraceProvider
    const captureContent = environment.DSH_TRACE_CAPTURE_CONTENT === 'true'
    const maximumCaptureChars = boundedNumber(environment.DSH_TRACE_MAX_CAPTURE_CHARS, 24_000)
    return {
      async traceModelCall(input, operation) {
        const metadata = JSON.stringify({ component: 'dsh-workbench', operation: 'dashboard-model-analysis', captureContent, rowCount: input.rowCount, fieldCount: input.fieldCount })
        const traced = withSpan(
          async () => operation(),
          {
            name: 'dsh-workbench.dashboard-model-analysis', kind: 'LLM',
            attributes: {
              'llm.model_name': input.model,
              'llm.provider': input.provider,
              'llm.invocation_parameters': JSON.stringify({ temperature: input.temperature, max_tokens: input.maxTokens }),
              metadata,
              // Phoenix Playground reconstructs an LLM call from these
              // OpenInference message fields. The generic input/output fields
              // below remain useful for raw trace inspection only.
              'llm.input_messages.0.message.role': 'user',
              'llm.input_messages.0.message.content': contentForTrace(input.prompt, captureContent, maximumCaptureChars),
              'input.value': captureContent ? truncate(input.prompt, maximumCaptureChars) : JSON.stringify({ captured: false, promptChars: input.prompt.length }),
              'input.mime_type': captureContent ? 'text/plain' : 'application/json',
            },
            processOutput: output => ({
              'llm.output_messages.0.message.role': 'assistant',
              'llm.output_messages.0.message.content': contentForTrace(output, captureContent, maximumCaptureChars),
              'output.value': captureContent ? truncate(output, maximumCaptureChars) : JSON.stringify({ captured: false, outputChars: output.length }),
              'output.mime_type': captureContent ? 'text/plain' : 'application/json',
            }),
          },
        )
        return traced()
      },
      async shutdown() { await provider.shutdown?.() },
    }
  } catch (error) {
    console.warn(`[dsh-workbench] Phoenix tracing disabled: ${message(error)}`)
    return noOpTracer()
  }
}

function noOpTracer(): WorkbenchTracer {
  return { traceModelCall: async (_input, operation) => operation(), shutdown: async () => undefined }
}
function boundedNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1_000 && parsed <= 100_000 ? parsed : fallback
}
function contentForTrace(value: string, captureContent: boolean, maximum: number): string {
  return captureContent ? truncate(value, maximum) : '[content capture disabled]'
}
function truncate(value: string, maximum: number): string { return value.length <= maximum ? value : `${value.slice(0, maximum)}…[truncated]` }
function message(error: unknown): string { return error instanceof Error ? error.message.slice(0, 240) : 'unknown initialization error' }
