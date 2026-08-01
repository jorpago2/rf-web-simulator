import type { RFProject } from '../engine/types'
import { validateProject } from './projectFile'

const DATABASE_NAME = 'rf-web-simulator'
const DATABASE_VERSION = 1
const PROJECT_STORE = 'projects'

export interface LocalProjectRecord {
  id: string
  updatedAt: number
  project: RFProject
}

export interface LocalProjectSummary {
  id: string
  name: string
  updatedAt: number
}

let databasePromise: Promise<IDBDatabase> | undefined

export async function saveLocalProject(
  id: string,
  project: RFProject,
): Promise<LocalProjectRecord> {
  const record: LocalProjectRecord = {
    id,
    updatedAt: Date.now(),
    project: validateProject(project),
  }
  const database = await openDatabase()
  const transaction = database.transaction(PROJECT_STORE, 'readwrite')
  transaction.objectStore(PROJECT_STORE).put(record)
  await transactionComplete(transaction)
  return record
}

export async function loadLocalProject(
  id: string,
): Promise<LocalProjectRecord | undefined> {
  const database = await openDatabase()
  const transaction = database.transaction(PROJECT_STORE, 'readonly')
  const record = await requestResult<LocalProjectRecord | undefined>(
    transaction.objectStore(PROJECT_STORE).get(id),
  )
  await transactionComplete(transaction)
  return record
    ? { ...record, project: validateProject(record.project) }
    : undefined
}

export async function listLocalProjects(): Promise<LocalProjectSummary[]> {
  const database = await openDatabase()
  const transaction = database.transaction(PROJECT_STORE, 'readonly')
  const records = await requestResult<LocalProjectRecord[]>(
    transaction.objectStore(PROJECT_STORE).getAll(),
  )
  await transactionComplete(transaction)
  return records
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ id, updatedAt, project }) => ({
      id,
      updatedAt,
      name: project.name,
    }))
}

export async function loadMostRecentProject(): Promise<
  LocalProjectRecord | undefined
> {
  const [latest] = await listLocalProjects()
  return latest ? loadLocalProject(latest.id) : undefined
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) {
    return Promise.reject(
      new Error('IndexedDB is unavailable in this browser.'),
    )
  }
  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PROJECT_STORE)) {
        request.result.createObjectStore(PROJECT_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB open failed.'))
  })
  return databasePromise
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed.'))
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
  })
}
