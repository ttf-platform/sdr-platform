'use client'

import React from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface MetricsChartProps {
  data: Array<{
    date: string
    sent: number
    opened: number
    replied: number
  }>
  title: string
}

export default function MetricsChart({ data, title }: MetricsChartProps) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <h3 className="text-lg font-semibold text-gray-900 mb-6">{title}</h3>
      
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="date" 
              stroke="#6b7280"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis 
              stroke="#6b7280"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip 
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
              }}
            />
            <Line 
              type="monotone" 
              dataKey="sent" 
              stroke="#2C4A3E" 
              strokeWidth={2}
              dot={{ fill: '#2C4A3E', strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6, stroke: '#2C4A3E', strokeWidth: 2 }}
              name="Sent"
            />
            <Line 
              type="monotone" 
              dataKey="opened" 
              stroke="#7AAF8E" 
              strokeWidth={2}
              dot={{ fill: '#7AAF8E', strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6, stroke: '#7AAF8E', strokeWidth: 2 }}
              name="Opened"
            />
            <Line 
              type="monotone" 
              dataKey="replied" 
              stroke="#10b981" 
              strokeWidth={2}
              dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6, stroke: '#10b981', strokeWidth: 2 }}
              name="Replied"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Légende */}
      <div className="flex items-center justify-center space-x-6 mt-4">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-primary rounded-full"></div>
          <span className="text-sm text-gray-600">Sent</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-primary-light rounded-full"></div>
          <span className="text-sm text-gray-600">Opened</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
          <span className="text-sm text-gray-600">Replied</span>
        </div>
      </div>
    </div>
  )
}