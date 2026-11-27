// The session state this plugin keeps (`$.state`), declared for `claude plugin validate`.

/**
 * An attachment a successful SendUserFile call sent that the viewer may draw, at its place in the
 * list, with the file it was then: a later read must still find that file at the path.
 */
export type RegisteredImage = {
  readonly index: number
  readonly path: string
  readonly realPath: string
  readonly size: number
  readonly mtimeMs: number
}

/** One successful SendUserFile call of this session, by its tool_use_id. */
export type RegisteredCall = { readonly id: string; readonly images: readonly RegisteredImage[] }

/** Whether this session's terminal draws pictures: not known yet, drawn, or drawn as their alt text. */
export type ImageSupport = 'unknown' | 'drawn' | 'alt'

declare module 'claude-code' {
  interface PluginState {
    'terminal-artifact-viewer': {
      calls: Shaped<RegisteredCall[]>
      support: Shaped<ImageSupport>
    }
  }
}
