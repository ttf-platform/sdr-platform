export const TAG_COLORS = [
  { value: 'gray',   bg: 'bg-gray-100',  text: 'text-gray-700',  border: 'border-gray-200',  dot: 'bg-gray-400'   },
  { value: 'blue',   bg: 'bg-blue-50',   text: 'text-blue-700',  border: 'border-blue-200',  dot: 'bg-blue-500'   },
  { value: 'green',  bg: 'bg-green-50',  text: 'text-green-700', border: 'border-green-200', dot: 'bg-green-500'  },
  { value: 'purple', bg: 'bg-purple-50', text: 'text-purple-700',border: 'border-purple-200',dot: 'bg-purple-500' },
  { value: 'orange', bg: 'bg-orange-50', text: 'text-orange-700',border: 'border-orange-200',dot: 'bg-orange-500' },
  { value: 'red',    bg: 'bg-red-50',    text: 'text-red-700',   border: 'border-red-200',   dot: 'bg-red-500'    },
  { value: 'yellow', bg: 'bg-yellow-50', text: 'text-yellow-700',border: 'border-yellow-200',dot: 'bg-yellow-500' },
  { value: 'pink',   bg: 'bg-pink-50',   text: 'text-pink-700',  border: 'border-pink-200',  dot: 'bg-pink-500'   },
]

export function getTagColorClasses(color: string) {
  return TAG_COLORS.find(c => c.value === color) ?? TAG_COLORS[0]
}
