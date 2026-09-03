import React from 'react'

// Texto livre → parágrafos com quebras de linha e URLs clicáveis.
export function NotesText({ text }) {
  const splitRe = /(https?:\/\/[^\s]+)/g
  const isUrl = (s) => /^https?:\/\//.test(s)
  return (
    <div className="proj-notes">
      {text.split('\n').map((line, i) => (
        <p key={i}>
          {line.split(splitRe).map((part, j) =>
            isUrl(part)
              ? <a key={j} href={part} target="_blank" rel="noreferrer">{part}</a>
              : part
          )}
        </p>
      ))}
    </div>
  )
}
