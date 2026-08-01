export function downloadTextFile(
  fileName: string,
  content: string,
  mediaType: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mediaType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export function safeFileName(name: string, extension: string): string {
  const stem = name
    .trim()
    .replace(/[<>:"/\\|?*]/gu, '-')
    .split('')
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
    .replace(/\s+/gu, '-')
    .slice(0, 120)
  return `${stem || 'rf-project'}.${extension}`
}
