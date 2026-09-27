export const desiredCommands = [
  {
    name: "jarvis",
    type: 1,
    description: "向 Jarvis 提問",
    options: [{ name: "prompt", description: "要詢問的內容", type: 3, required: true }],
  },
  {
    name: "capture",
    type: 1,
    description: "保存來源連結",
    options: [{ name: "url", description: "要保存的網址", type: 3, required: true }],
  },
  {
    name: "status",
    type: 1,
    description: "查看 Jarvis 工作狀態",
    options: [],
  },
];

function comparable(command) {
  return JSON.stringify({
    name: command.name,
    type: command.type,
    description: command.description,
    options: (command.options ?? []).map((option) => ({
      name: option.name,
      description: option.description,
      type: option.type,
      required: option.required ?? false,
    })),
  });
}

export function planCommandChanges(existing, desired = desiredCommands) {
  return desired.map((command) => {
    const current = existing.find((item) => item.name === command.name && item.type === command.type);
    if (!current) return { action: "create", command };
    if (comparable(current) !== comparable(command)) return { action: "update", id: current.id, command };
    return { action: "unchanged", id: current.id, command };
  });
}
