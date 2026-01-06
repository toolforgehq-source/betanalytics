// In-memory database for POC
// Note: Data will be lost when the app restarts

import { v4 as uuidv4 } from 'uuid'

export interface User {
  id: string
  email: string
  passwordHash: string
  name: string | null
  createdAt: Date
  termsAcceptedAt: Date | null
  questionCount: number
}

export interface Subscription {
  id: string
  userId: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripePriceId: string | null
  status: string
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Conversation {
  id: string
  userId: string
  title: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

// In-memory storage
const users: Map<string, User> = new Map()
const subscriptions: Map<string, Subscription> = new Map()
const conversations: Map<string, Conversation> = new Map()
const messages: Map<string, Message> = new Map()

// User operations
export const db = {
  users: {
    create: (data: Omit<User, 'id' | 'createdAt'>): User => {
      const user: User = {
        id: uuidv4(),
        createdAt: new Date(),
        ...data,
      }
      users.set(user.id, user)
      return user
    },
    findByEmail: (email: string): User | undefined => {
      return Array.from(users.values()).find(u => u.email.toLowerCase() === email.toLowerCase())
    },
    findById: (id: string): User | undefined => {
      return users.get(id)
    },
    update: (id: string, data: Partial<User>): User | undefined => {
      const user = users.get(id)
      if (!user) return undefined
      const updated = { ...user, ...data }
      users.set(id, updated)
      return updated
    },
  },
  subscriptions: {
    create: (data: Omit<Subscription, 'id' | 'createdAt' | 'updatedAt'>): Subscription => {
      const subscription: Subscription = {
        id: uuidv4(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }
      subscriptions.set(subscription.id, subscription)
      return subscription
    },
    findByUserId: (userId: string): Subscription | undefined => {
      return Array.from(subscriptions.values()).find(s => s.userId === userId)
    },
    findByStripeSubscriptionId: (stripeSubscriptionId: string): Subscription | undefined => {
      return Array.from(subscriptions.values()).find(s => s.stripeSubscriptionId === stripeSubscriptionId)
    },
    findByStripeCustomerId: (stripeCustomerId: string): Subscription | undefined => {
      return Array.from(subscriptions.values()).find(s => s.stripeCustomerId === stripeCustomerId)
    },
    update: (id: string, data: Partial<Subscription>): Subscription | undefined => {
      const subscription = subscriptions.get(id)
      if (!subscription) return undefined
      const updated = { ...subscription, ...data, updatedAt: new Date() }
      subscriptions.set(id, updated)
      return updated
    },
    updateByStripeSubscriptionId: (stripeSubscriptionId: string, data: Partial<Subscription>): Subscription | undefined => {
      const subscription = Array.from(subscriptions.values()).find(s => s.stripeSubscriptionId === stripeSubscriptionId)
      if (!subscription) return undefined
      const updated = { ...subscription, ...data, updatedAt: new Date() }
      subscriptions.set(subscription.id, updated)
      return updated
    },
  },
  conversations: {
    create: (data: Omit<Conversation, 'id' | 'createdAt' | 'updatedAt'>): Conversation => {
      const conversation: Conversation = {
        id: uuidv4(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }
      conversations.set(conversation.id, conversation)
      return conversation
    },
    findByUserId: (userId: string): Conversation[] => {
      return Array.from(conversations.values())
        .filter(c => c.userId === userId)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    },
    findById: (id: string): Conversation | undefined => {
      return conversations.get(id)
    },
    update: (id: string, data: Partial<Conversation>): Conversation | undefined => {
      const conversation = conversations.get(id)
      if (!conversation) return undefined
      const updated = { ...conversation, ...data, updatedAt: new Date() }
      conversations.set(id, updated)
      return updated
    },
  },
  messages: {
    create: (data: Omit<Message, 'id' | 'timestamp'>): Message => {
      const message: Message = {
        id: uuidv4(),
        timestamp: new Date(),
        ...data,
      }
      messages.set(message.id, message)
      return message
    },
    findByConversationId: (conversationId: string): Message[] => {
      return Array.from(messages.values())
        .filter(m => m.conversationId === conversationId)
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    },
  },
}
