// Database with Upstash Redis for persistence
// Falls back to in-memory storage for local development

import { v4 as uuidv4 } from 'uuid'

export interface User {
  id: string
  email: string
  passwordHash: string
  name: string | null
  createdAt: string
  termsAcceptedAt: string | null
  questionCount: number
}

export interface Subscription {
  id: string
  userId: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripePriceId: string | null
  status: string
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  createdAt: string
  updatedAt: string
}

export interface Conversation {
  id: string
  userId: string
  title: string | null
  createdAt: string
  updatedAt: string
}

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

// Upstash Redis REST API helper
const getRedisConfig = () => {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  return { url, token, useRedis: !!(url && token) }
}

async function redisCommand(command: string[]): Promise<unknown> {
  const { url, token } = getRedisConfig()
  if (!url || !token) {
    throw new Error('Redis not configured')
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  })
  
  const data = await response.json()
  if (data.error) {
    throw new Error(data.error)
  }
  return data.result
}

// In-memory fallback storage for local development
const memoryUsers: Map<string, User> = new Map()
const memorySubscriptions: Map<string, Subscription> = new Map()
const memoryConversations: Map<string, Conversation> = new Map()
const memoryMessages: Map<string, Message> = new Map()

// User operations
export const db = {
  users: {
    create: async (data: Omit<User, 'id' | 'createdAt'>): Promise<User> => {
      const user: User = {
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        ...data,
      }
      
      const { useRedis } = getRedisConfig()
      if (useRedis) {
        await redisCommand(['SET', `user:${user.id}`, JSON.stringify(user)])
        await redisCommand(['SET', `user_email:${user.email.toLowerCase()}`, user.id])
      } else {
        memoryUsers.set(user.id, user)
      }
      
      return user
    },
    
    findByEmail: async (email: string): Promise<User | undefined> => {
      const { useRedis } = getRedisConfig()
      if (useRedis) {
        const userId = await redisCommand(['GET', `user_email:${email.toLowerCase()}`]) as string | null
        if (!userId) return undefined
        const userData = await redisCommand(['GET', `user:${userId}`]) as string | null
        if (!userData) return undefined
        return JSON.parse(userData) as User
      } else {
        return Array.from(memoryUsers.values()).find(u => u.email.toLowerCase() === email.toLowerCase())
      }
    },
    
    findById: async (id: string): Promise<User | undefined> => {
      const { useRedis } = getRedisConfig()
      if (useRedis) {
        const userData = await redisCommand(['GET', `user:${id}`]) as string | null
        if (!userData) return undefined
        return JSON.parse(userData) as User
      } else {
        return memoryUsers.get(id)
      }
    },
    
    update: async (id: string, data: Partial<User>): Promise<User | undefined> => {
      const { useRedis } = getRedisConfig()
      if (useRedis) {
        const existing = await db.users.findById(id)
        if (!existing) return undefined
        const updated = { ...existing, ...data }
        await redisCommand(['SET', `user:${id}`, JSON.stringify(updated)])
        return updated
      } else {
        const user = memoryUsers.get(id)
        if (!user) return undefined
        const updated = { ...user, ...data }
        memoryUsers.set(id, updated)
        return updated
      }
    },
  },
  
  subscriptions: {
    create: async (data: Omit<Subscription, 'id' | 'createdAt' | 'updatedAt'>): Promise<Subscription> => {
      const subscription: Subscription = {
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...data,
      }
      
      const { useRedis } = getRedisConfig()
      if (useRedis) {
        await redisCommand(['SET', `subscription:${subscription.id}`, JSON.stringify(subscription)])
        await redisCommand(['SET', `sub_user:${subscription.userId}`, subscription.id])
        if (subscription.stripeSubscriptionId) {
          await redisCommand(['SET', `sub_stripe:${subscription.stripeSubscriptionId}`, subscription.id])
        }
        if (subscription.stripeCustomerId) {
          await redisCommand(['SET', `sub_customer:${subscription.stripeCustomerId}`, subscription.id])
        }
      } else {
        memorySubscriptions.set(subscription.id, subscription)
      }
      
      return subscription
    },
    
    findByUserId: async (userId: string): Promise<Subscription | undefined> => {
      const { useRedis } = getRedisConfig()
      if (useRedis) {
        const subId = await redisCommand(['GET', `sub_user:${userId}`]) as string | null
        if (!subId) return undefined
        const subData = await redisCommand(['GET', `subscription:${subId}`]) as string | null
        if (!subData) return undefined
        return JSON.parse(subData) as Subscription
      } else {
        return Array.from(memorySubscriptions.values()).find(s => s.userId === userId)
      }
    },
    
    findByStripeSubscriptionId: async (stripeSubscriptionId: string): Promise<Subscription | undefined> => {
      const { useRedis } = getRedisConfig()
      if (useRedis) {
        const subId = await redisCommand(['GET', `sub_stripe:${stripeSubscriptionId}`]) as string | null
        if (!subId) return undefined
        const subData = await redisCommand(['GET', `subscription:${subId}`]) as string | null
        if (!subData) return undefined
        return JSON.parse(subData) as Subscription
      } else {
        return Array.from(memorySubscriptions.values()).find(s => s.stripeSubscriptionId === stripeSubscriptionId)
      }
    },
    
    findByStripeCustomerId: async (stripeCustomerId: string): Promise<Subscription | undefined> => {
      const { useRedis } = getRedisConfig()
      if (useRedis) {
        const subId = await redisCommand(['GET', `sub_customer:${stripeCustomerId}`]) as string | null
        if (!subId) return undefined
        const subData = await redisCommand(['GET', `subscription:${subId}`]) as string | null
        if (!subData) return undefined
        return JSON.parse(subData) as Subscription
      } else {
        return Array.from(memorySubscriptions.values()).find(s => s.stripeCustomerId === stripeCustomerId)
      }
    },
    
    update: async (id: string, data: Partial<Subscription>): Promise<Subscription | undefined> => {
      const { useRedis } = getRedisConfig()
      if (useRedis) {
        const subData = await redisCommand(['GET', `subscription:${id}`]) as string | null
        if (!subData) return undefined
        const existing = JSON.parse(subData) as Subscription
        const updated = { ...existing, ...data, updatedAt: new Date().toISOString() }
        await redisCommand(['SET', `subscription:${id}`, JSON.stringify(updated)])
        return updated
      } else {
        const subscription = memorySubscriptions.get(id)
        if (!subscription) return undefined
        const updated = { ...subscription, ...data, updatedAt: new Date().toISOString() }
        memorySubscriptions.set(id, updated)
        return updated
      }
    },
    
    updateByStripeSubscriptionId: async (stripeSubscriptionId: string, data: Partial<Subscription>): Promise<Subscription | undefined> => {
      const subscription = await db.subscriptions.findByStripeSubscriptionId(stripeSubscriptionId)
      if (!subscription) return undefined
      return db.subscriptions.update(subscription.id, data)
    },
  },
  
  conversations: {
    create: async (data: Omit<Conversation, 'id' | 'createdAt' | 'updatedAt'>): Promise<Conversation> => {
      const conversation: Conversation = {
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...data,
      }
      
      const { useRedis } = getRedisConfig()
      if (useRedis) {
        await redisCommand(['SET', `conversation:${conversation.id}`, JSON.stringify(conversation)])
        await redisCommand(['LPUSH', `user_conversations:${conversation.userId}`, conversation.id])
      } else {
        memoryConversations.set(conversation.id, conversation)
      }
      
      return conversation
    },
    
    findByUserId: async (userId: string): Promise<Conversation[]> => {
      const { useRedis } = getRedisConfig()
      if (useRedis) {
        const convIds = await redisCommand(['LRANGE', `user_conversations:${userId}`, '0', '-1']) as string[]
        if (!convIds || convIds.length === 0) return []
        const conversations: Conversation[] = []
        for (const id of convIds) {
          const convData = await redisCommand(['GET', `conversation:${id}`]) as string | null
          if (convData) {
            conversations.push(JSON.parse(convData) as Conversation)
          }
        }
        return conversations.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      } else {
        return Array.from(memoryConversations.values())
          .filter(c => c.userId === userId)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      }
    },
    
    findById: async (id: string): Promise<Conversation | undefined> => {
      const { useRedis } = getRedisConfig()
      if (useRedis) {
        const convData = await redisCommand(['GET', `conversation:${id}`]) as string | null
        if (!convData) return undefined
        return JSON.parse(convData) as Conversation
      } else {
        return memoryConversations.get(id)
      }
    },
    
    update: async (id: string, data: Partial<Conversation>): Promise<Conversation | undefined> => {
      const { useRedis } = getRedisConfig()
      if (useRedis) {
        const convData = await redisCommand(['GET', `conversation:${id}`]) as string | null
        if (!convData) return undefined
        const existing = JSON.parse(convData) as Conversation
        const updated = { ...existing, ...data, updatedAt: new Date().toISOString() }
        await redisCommand(['SET', `conversation:${id}`, JSON.stringify(updated)])
        return updated
      } else {
        const conversation = memoryConversations.get(id)
        if (!conversation) return undefined
        const updated = { ...conversation, ...data, updatedAt: new Date().toISOString() }
        memoryConversations.set(id, updated)
        return updated
      }
    },
  },
  
  messages: {
    create: async (data: Omit<Message, 'id' | 'timestamp'>): Promise<Message> => {
      const message: Message = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        ...data,
      }
      
      const { useRedis } = getRedisConfig()
      if (useRedis) {
        await redisCommand(['SET', `message:${message.id}`, JSON.stringify(message)])
        await redisCommand(['RPUSH', `conversation_messages:${message.conversationId}`, message.id])
      } else {
        memoryMessages.set(message.id, message)
      }
      
      return message
    },
    
    findByConversationId: async (conversationId: string): Promise<Message[]> => {
      const { useRedis } = getRedisConfig()
      if (useRedis) {
        const msgIds = await redisCommand(['LRANGE', `conversation_messages:${conversationId}`, '0', '-1']) as string[]
        if (!msgIds || msgIds.length === 0) return []
        const messages: Message[] = []
        for (const id of msgIds) {
          const msgData = await redisCommand(['GET', `message:${id}`]) as string | null
          if (msgData) {
            messages.push(JSON.parse(msgData) as Message)
          }
        }
        return messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      } else {
        return Array.from(memoryMessages.values())
          .filter(m => m.conversationId === conversationId)
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      }
    },
  },
}
