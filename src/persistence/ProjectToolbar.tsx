import {
  Button,
  ComposedModal,
  FileUploaderButton,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  TextInput,
  preview__IconIndicator as IconIndicator,
} from '@carbon/react'
import { FolderOpen } from '@carbon/icons-react'
import { useState, type ChangeEvent } from 'react'
import { rfTemplates } from '../templates'
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
  onLoadTemplate,
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
  onLoadTemplate: (id: string) => void
}) {
  const [templateId, setTemplateId] = useState('')
  const [actionsOpen, setActionsOpen] = useState(false)
  const importProject = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onImport(file)
    event.target.value = ''
  }

  return (
    <div className="project-toolbar" aria-label="Project controls">
      <TextInput
        className="project-name-field"
        id="project-name"
        labelText="Project"
        maxLength={200}
        size="sm"
        value={projectName}
        onChange={(event) => onProjectNameChange(event.target.value)}
      />
      <span
        className={`save-state save-state--${status}`}
        aria-live="polite"
        title={message ?? undefined}
      >
        <IconIndicator
          kind={statusKind(status)}
          label={message ?? statusLabel(status)}
        />
      </span>
      <Button
        className="project-actions-button"
        kind="ghost"
        size="sm"
        onClick={() => setActionsOpen(true)}
      >
        <FolderOpen
          className="project-actions-button__icon"
          aria-hidden="true"
        />
        <span className="project-actions-button__label">Project actions</span>
      </Button>
      <ComposedModal
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        selectorPrimaryFocus="#recent-project"
        size="sm"
      >
        <ModalHeader
          label="RF Network Simulator"
          title="Project actions"
          closeModal={() => setActionsOpen(false)}
        />
        <ModalBody hasForm>
          <div className="project-actions__panel">
            <Select
              id="recent-project"
              labelText="Recent project"
              size="sm"
              value={selectedProjectId}
              onChange={(event) => onSelectedProjectChange(event.target.value)}
            >
              <SelectItem value="" text="Choose a saved project" />
              {recentProjects.map((project) => (
                <SelectItem
                  key={project.id}
                  value={project.id}
                  text={`${project.name} · ${new Date(project.updatedAt).toLocaleString()}`}
                />
              ))}
            </Select>
            <Button
              kind="secondary"
              size="sm"
              disabled={!selectedProjectId}
              onClick={onOpen}
            >
              Open
            </Button>
            <Select
              id="project-template"
              labelText="Template"
              size="sm"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              title={
                rfTemplates.find((template) => template.id === templateId)
                  ?.description
              }
            >
              <SelectItem value="" text="Choose a template" />
              {rfTemplates.map((template) => (
                <SelectItem
                  key={template.id}
                  value={template.id}
                  text={template.label}
                />
              ))}
            </Select>
            <Button
              kind="secondary"
              size="sm"
              disabled={!templateId}
              onClick={() => {
                onLoadTemplate(templateId)
                setTemplateId('')
                setActionsOpen(false)
              }}
            >
              Load template
            </Button>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button kind="ghost" onClick={onNew}>
            New project
          </Button>
          <Button kind="secondary" onClick={onExport}>
            Export JSON
          </Button>
          <FileUploaderButton
            accept={['application/json', '.json']}
            buttonKind="primary"
            labelText="Import JSON"
            multiple={false}
            onChange={importProject}
          />
        </ModalFooter>
      </ComposedModal>
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

function statusKind(status: PersistenceStatus) {
  return {
    loading: 'pending',
    saving: 'in-progress',
    saved: 'succeeded',
    error: 'failed',
  }[status] as 'pending' | 'in-progress' | 'succeeded' | 'failed'
}
