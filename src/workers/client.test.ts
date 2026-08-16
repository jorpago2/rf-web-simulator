import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SimulationInput } from '../engine/types'
import { simulateInWorker } from './client'

describe('RF worker client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('terminates the worker when the request is cancelled', async () => {
    const terminate = vi.fn()
    vi.stubGlobal(
      'Worker',
      class {
        onmessage = null
        onerror = null
        postMessage() {}
        terminate = terminate
      },
    )
    const controller = new AbortController()
    const request = simulateInWorker({} as SimulationInput, controller.signal)

    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(terminate).toHaveBeenCalledOnce()
  })

  it('cleans up when posting the request fails', async () => {
    const terminate = vi.fn()
    vi.stubGlobal(
      'Worker',
      class {
        onmessage = null
        onerror = null
        postMessage() {
          throw new Error('clone failed')
        }
        terminate = terminate
      },
    )

    const request = simulateInWorker({} as SimulationInput)

    await expect(request).rejects.toThrow('clone failed')
    expect(terminate).toHaveBeenCalledOnce()
  })

  it('handles an abort that happens while posting the request', async () => {
    const terminate = vi.fn()
    const controller = new AbortController()
    vi.stubGlobal(
      'Worker',
      class {
        onmessage = null
        onerror = null
        postMessage() {
          controller.abort()
        }
        terminate = terminate
      },
    )

    const request = simulateInWorker({} as SimulationInput, controller.signal)

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(terminate).toHaveBeenCalledOnce()
  })
})
