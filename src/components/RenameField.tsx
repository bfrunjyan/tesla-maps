import { useEffect, useRef, useState } from 'react'
import { Check } from '@phosphor-icons/react'

/** Inline name editor: Enter or ✓ saves, Escape cancels, leaving the field saves. */
export function RenameField({ initial, onSave, onCancel }: { initial: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const save = () => {
    if (done.current) return
    done.current = true
    const v = value.trim()
    if (v && v !== initial) onSave(v)
    else onCancel()
  }

  return (
    <form
      className="rename"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <input
        ref={ref}
        className="field__input rename__input"
        aria-label="Name"
        value={value}
        maxLength={80}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="done"
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            done.current = true
            onCancel()
          }
        }}
      />
      <button className="icon-btn" type="submit" aria-label="Save name" onMouseDown={(e) => e.preventDefault()}>
        <Check size={22} weight="bold" />
      </button>
    </form>
  )
}
