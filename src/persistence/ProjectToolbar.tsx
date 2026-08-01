import type { ChangeEvent } from 'react'
import type { LocalProjectSummary } from './indexedDb'

export type PersistenceStatus = 'loading' | 'saving' | 'saved' | 'error'

export function ProjectToolbar({
  projectName,
  status,
  message,
  recentProjects,
  selectedProjectId,
  onProjectNameChange,
  onSelectedProjectChange,
  onNew,
  onOpen,
  onExport,
  onImport,
}: {
  projectName: string
  status: PersistenceStatus
  message: string | null
  recentProjects: LocalProjectSummary[]
  selectedProjectId: string
  onProjectNameChange: (name: string) => void
  onSelectedProjectChange: (id: string) => void
  onNew: () => void
  onOpen: () => void
  onExport: () => void
  onImport: (file: File) => void
}) {
  const importProject = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onImport(file)
    event.target.value = ''
  }

  return (
    <div className="project-toolbar" aria-label="Project controls">
      <label className="project-name-field">
        <span>Project</span>
        <input
          value={projectName}
          maxLength={200}
          onChange={(event) => onProjectNameChange(event.target.value)}
        />
      </label>
      <span
        className={`save-state save-state--${status}`}
        aria-live="polite"
        title={message ?? undefined}
      >
        {message ?? statusLabel(status)}
      </span>
      <label className="recent-project-field">
        <span className="sr-only">Recent local project</span>
        <select
          value={selectedProjectId}
          onChange={(event) => onSelectedProjectChange(event.target.value)}
          aria-label="Recent local project"
        >
          <option value="">Recent projects</option>
          {recentProjects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name} · {new Date(project.updatedAt).toLocaleString()}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={onOpen} disabled={!selectedProjectId}>
        Open
      </button>
      <button type="button" onClick={onNew}>
        New
      </button>
      <button type="button" onClick={onExport}>
        Export JSON
      </button>
      <label className="project-file-button">
        Import JSON
        <input
          type="file"
          accept="application/json,.json"
          onChange={importProject}
        />
      </label>
    </div>
  )
}

function statusLabel(status: PersistenceStatus): string {
  return {
    loading: 'Loading local project…',
    saving: 'Saving locally…',
    saved: 'Saved locally',
    error: 'Local save error',
  }[status]
}
