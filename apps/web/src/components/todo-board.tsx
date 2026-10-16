import { Button } from "@ai-first-ts/ui/components/button";
import { Checkbox } from "@ai-first-ts/ui/components/checkbox";
import { Input } from "@ai-first-ts/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

export default function TodoBoard() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#888888");
  const [filterTagId, setFilterTagId] = useState<string | undefined>();

  const todos = useQuery(orpc.todo.list.queryOptions({ input: { tagId: filterTagId } }));
  const tags = useQuery(orpc.tag.list.queryOptions());

  const invalidate = () => {
    void queryClient.invalidateQueries();
  };

  const addTodo = useMutation(
    orpc.todo.add.mutationOptions({
      onSuccess: () => {
        setTitle("");
        setDueAt("");
        invalidate();
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const setCompleted = useMutation(
    orpc.todo.setCompleted.mutationOptions({ onSuccess: invalidate }),
  );
  const removeTodo = useMutation(orpc.todo.remove.mutationOptions({ onSuccess: invalidate }));
  const createTag = useMutation(
    orpc.tag.create.mutationOptions({
      onSuccess: () => {
        setTagName("");
        invalidate();
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const attach = useMutation(orpc.tag.attach.mutationOptions({ onSuccess: invalidate }));
  const detach = useMutation(orpc.tag.detach.mutationOptions({ onSuccess: invalidate }));

  return (
    <div className="space-y-6">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addTodo.mutate({ title, dueAt: dueAt ? new Date(dueAt) : undefined });
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New todo" />
        <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        <Button type="submit">Add</Button>
      </form>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          createTag.mutate({ name: tagName, color: tagColor });
        }}
      >
        <Input value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="New tag" />
        <Input type="color" value={tagColor} onChange={(e) => setTagColor(e.target.value)} />
        <Button type="submit">Create tag</Button>
      </form>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={filterTagId ? "outline" : "default"}
          onClick={() => setFilterTagId(undefined)}
        >
          All
        </Button>
        {tags.data?.map((tag) => (
          <Button
            key={tag.id}
            variant={filterTagId === tag.id ? "default" : "outline"}
            style={{ borderColor: tag.color }}
            onClick={() => setFilterTagId(tag.id)}
          >
            {tag.name}
          </Button>
        ))}
      </div>

      <ul className="space-y-2">
        {todos.data?.map((todo) => (
          <li key={todo.id} className="flex items-center gap-2">
            <Checkbox
              checked={todo.completed}
              onCheckedChange={(checked) =>
                setCompleted.mutate({ id: todo.id, completed: checked === true })
              }
            />
            <span className={todo.overdue ? "text-red-500" : ""}>{todo.title}</span>
            {todo.dueAt && (
              <span className="text-xs">{new Date(todo.dueAt).toLocaleDateString()}</span>
            )}
            {todo.tags.map((tag) => (
              <span
                key={tag.id}
                className="rounded px-1 text-xs text-white"
                style={{ backgroundColor: tag.color }}
                onClick={() => detach.mutate({ todoId: todo.id, tagId: tag.id })}
              >
                {tag.name}
              </span>
            ))}
            <select
              value=""
              onChange={(e) => attach.mutate({ todoId: todo.id, tagId: e.target.value })}
            >
              <option value="">+ tag</option>
              {tags.data?.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
            <Button variant="ghost" onClick={() => removeTodo.mutate({ id: todo.id })}>
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
