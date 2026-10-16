import { Button } from "@ai-first-ts/ui/components/button";
import { Checkbox } from "@ai-first-ts/ui/components/checkbox";
import { Input } from "@ai-first-ts/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

/** 端末のタイムゾーンでの今日（YYYY-MM-DD）。期限切れの判定に使う。 */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const showError = (error: Error) => {
  toast.error(error.message);
};

export default function TodoBoard() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#888888");
  const [filterTagId, setFilterTagId] = useState<string | undefined>();

  const todos = useQuery(
    orpc.todo.list.queryOptions({
      input:
        filterTagId === undefined
          ? { today: localToday() }
          : { tagId: filterTagId, today: localToday() },
    }),
  );
  const tags = useQuery(orpc.tag.list.queryOptions());

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.todo.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.tag.key() });
  };
  const mutationHandlers = { onSuccess: invalidate, onError: showError };

  const addTodo = useMutation(
    orpc.todo.add.mutationOptions({
      onSuccess: () => {
        setTitle("");
        setDueOn("");
        invalidate();
      },
      onError: showError,
    }),
  );
  const setCompleted = useMutation(orpc.todo.setCompleted.mutationOptions(mutationHandlers));
  const removeTodo = useMutation(orpc.todo.remove.mutationOptions(mutationHandlers));
  const createTag = useMutation(
    orpc.tag.create.mutationOptions({
      onSuccess: () => {
        setTagName("");
        invalidate();
      },
      onError: showError,
    }),
  );
  const removeTag = useMutation(
    orpc.tag.remove.mutationOptions({
      onSuccess: () => {
        setFilterTagId(undefined);
        invalidate();
      },
      onError: showError,
    }),
  );
  const attach = useMutation(orpc.tag.attach.mutationOptions(mutationHandlers));
  const detach = useMutation(orpc.tag.detach.mutationOptions(mutationHandlers));

  return (
    <div className="space-y-6">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addTodo.mutate(dueOn === "" ? { title } : { title, dueOn });
        }}
      >
        <Input
          aria-label="Todo title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New todo"
        />
        <Input
          aria-label="Due date"
          type="date"
          value={dueOn}
          onChange={(e) => setDueOn(e.target.value)}
        />
        <Button type="submit" disabled={addTodo.isPending}>
          Add
        </Button>
      </form>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          createTag.mutate({ name: tagName, color: tagColor });
        }}
      >
        <Input
          aria-label="Tag name"
          value={tagName}
          onChange={(e) => setTagName(e.target.value)}
          placeholder="New tag"
        />
        <Input
          aria-label="Tag color"
          type="color"
          value={tagColor}
          onChange={(e) => setTagColor(e.target.value)}
        />
        <Button type="submit" disabled={createTag.isPending}>
          Create tag
        </Button>
      </form>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={filterTagId === undefined ? "default" : "outline"}
          onClick={() => setFilterTagId(undefined)}
        >
          All
        </Button>
        {tags.data?.map((tag) => (
          <span key={tag.id} className="flex items-center">
            <Button
              variant={filterTagId === tag.id ? "default" : "outline"}
              style={{ borderColor: tag.color }}
              onClick={() => setFilterTagId(tag.id)}
            >
              {tag.name}
            </Button>
            <Button
              variant="ghost"
              aria-label={`Delete tag ${tag.name}`}
              onClick={() => removeTag.mutate({ id: tag.id })}
            >
              ×
            </Button>
          </span>
        ))}
      </div>

      <ul className="space-y-2">
        {todos.data?.map((todo) => (
          <li key={todo.id} className="flex items-center gap-2">
            <Checkbox
              aria-label={`Complete ${todo.title}`}
              checked={todo.completed}
              onCheckedChange={(checked) =>
                setCompleted.mutate({ id: todo.id, completed: checked === true })
              }
            />
            <span className={todo.overdue ? "text-red-500" : ""}>{todo.title}</span>
            {todo.dueOn !== null && <span className="text-xs">{todo.dueOn}</span>}
            {todo.tags.map((tag) => (
              <button
                type="button"
                key={tag.id}
                aria-label={`Remove tag ${tag.name} from ${todo.title}`}
                className="rounded px-1 text-xs text-white"
                style={{ backgroundColor: tag.color }}
                onClick={() => detach.mutate({ todoId: todo.id, tagId: tag.id })}
              >
                {tag.name} ×
              </button>
            ))}
            <select
              aria-label={`Add tag to ${todo.title}`}
              value=""
              onChange={(e) => {
                if (e.target.value !== "") {
                  attach.mutate({ todoId: todo.id, tagId: e.target.value });
                }
              }}
            >
              <option value="">+ tag</option>
              {tags.data
                ?.filter((tag) => !todo.tags.some((t) => t.id === tag.id))
                .map((tag) => (
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
