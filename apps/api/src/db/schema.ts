// Column names are camelCase here; CamelCasePlugin maps them to snake_case in SQL.
export type UserTable = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  googleSub: string | null
  totpSecret: string | null
  totpEnabled: number
  createdAt: string
  updatedAt: string
}

export type SessionTable = {
  tokenHash: string
  userId: string
  pendingTwoFactor: number
  expiresAt: string
  createdAt: string
}

export type WorkspaceTable = {
  id: string
  name: string
  slug: string
  createdAt: string
  updatedAt: string
}

export type WorkspaceMemberTable = {
  id: string
  workspaceId: string
  userId: string
  role: "owner" | "member"
  createdAt: string
}

export type ProjectTable = {
  id: string
  workspaceId: string
  name: string
  key: string
  description: string | null
  taskCounter: number
  createdAt: string
  updatedAt: string
}

export type TaskTable = {
  id: string
  workspaceId: string
  projectId: string
  parentTaskId: string | null
  number: number
  title: string
  body: string | null
  status: string
  priority: string | null
  dueAt: string | null
  // Fractional-index key ordering the task within its board column; see tasks/order.ts.
  position: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type TaskAssigneeTable = { taskId: string; userId: string }

export type TagTable = {
  id: string
  workspaceId: string
  name: string
  color: string
  createdAt: string
}

export type TaskTagTable = { taskId: string; tagId: string }

export type TaskRelationshipTable = {
  id: string
  sourceTaskId: string
  targetTaskId: string
  type: "blocks" | "related"
  createdAt: string
}

export type TaskStatusHistoryTable = {
  id: string
  taskId: string
  fromStatus: string | null
  toStatus: string
  updatedAt: string
  updatedBy: string
}

export type CustomFieldDefinitionTable = {
  id: string
  projectId: string
  name: string
  type: string
  required: number
  options: string | null
  position: number
  createdAt: string
}

export type TaskCustomFieldValueTable = {
  taskId: string
  fieldId: string
  value: string
}

export type Database = {
  artifacts: {
    id: string
    taskId: string
    name: string
    mimeType: string
    size: number
    content: Uint8Array
    createdAt: string
    updatedAt: string
  }
  users: UserTable
  sessions: SessionTable
  workspaces: WorkspaceTable
  workspaceMembers: WorkspaceMemberTable
  projects: ProjectTable
  tasks: TaskTable
  taskAssignees: TaskAssigneeTable
  tags: TagTable
  taskTags: TaskTagTable
  taskRelationships: TaskRelationshipTable
  taskStatusHistory: TaskStatusHistoryTable
  customFieldDefinitions: CustomFieldDefinitionTable
  taskCustomFieldValues: TaskCustomFieldValueTable
}
