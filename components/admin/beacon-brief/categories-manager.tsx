"use client";

import { useState, useTransition } from "react";
import {
  createCategory,
  deleteCategory,
  toggleCategory,
  updateCategory,
} from "@/app/admin/beacon-brief/actions";

export interface CategoryView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  discord_role_ids: string[];
  display_order: number;
  is_active: boolean;
}

const inputClass =
  "min-h-[44px] w-full rounded-card border border-line bg-base px-3 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan";
const btnClass =
  "min-h-[44px] rounded-card border border-line bg-base px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan disabled:opacity-50";

const toList = (s: string): string[] =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function CategoriesManager({
  categories,
}: {
  categories: CategoryView[];
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [roles, setRoles] = useState("");
  const [order, setOrder] = useState("0");
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState("");
  const [eDesc, setEDesc] = useState("");
  const [eRoles, setERoles] = useState("");
  const [eOrder, setEOrder] = useState("0");

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    okMsg: string,
  ) =>
    startTransition(async () => {
      setStatus(null);
      const res = await fn();
      setStatus(res.ok ? okMsg : `Failed: ${res.error}`);
    });

  return (
    <div className="space-y-6">
      <p aria-live="polite" className="min-h-[1.25rem] text-sm text-ink-muted">
        {status}
      </p>

      <form
        className="rounded-card border border-line bg-surface/60 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const res = await createCategory(
              name,
              desc,
              toList(roles),
              Number(order),
            );
            if (res.ok) {
              setName("");
              setDesc("");
              setRoles("");
              setOrder("0");
            }
            return res;
          }, "Category added.");
        }}
      >
        <h2 className="text-base font-semibold text-ink">Add a category</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Name</span>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">
              Display order
            </span>
            <input
              className={inputClass}
              type="number"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-ink">Description</span>
            <input
              className={inputClass}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-ink">
              Discord role ids to ping (comma separated)
            </span>
            <input
              className={inputClass}
              value={roles}
              onChange={(e) => setRoles(e.target.value)}
              placeholder="123456789, 987654321"
            />
          </label>
        </div>
        <button type="submit" disabled={pending} className={`mt-3 ${btnClass}`}>
          {pending ? "Saving..." : "Add category"}
        </button>
      </form>

      <section aria-labelledby="cat-list">
        <h2 id="cat-list" className="text-base font-semibold text-ink">
          Categories
        </h2>
        {categories.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            No categories yet. Add the categories the AI should choose from.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {categories.map((c) => (
              <li
                key={c.id}
                className="rounded-card border border-line bg-surface/60 p-4"
              >
                {editId === c.id ? (
                  <div className="space-y-3">
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-ink">
                        Name
                      </span>
                      <input
                        className={inputClass}
                        value={eName}
                        onChange={(e) => setEName(e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-ink">
                        Description
                      </span>
                      <input
                        className={inputClass}
                        value={eDesc}
                        onChange={(e) => setEDesc(e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-ink">
                        Discord role ids (comma separated)
                      </span>
                      <input
                        className={inputClass}
                        value={eRoles}
                        onChange={(e) => setERoles(e.target.value)}
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-ink">
                        Display order
                      </span>
                      <input
                        className={inputClass}
                        type="number"
                        value={eOrder}
                        onChange={(e) => setEOrder(e.target.value)}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        className={btnClass}
                        onClick={() =>
                          run(async () => {
                            const res = await updateCategory(
                              c.id,
                              eName,
                              eDesc,
                              toList(eRoles),
                              Number(eOrder),
                            );
                            if (res.ok) setEditId(null);
                            return res;
                          }, "Category updated.")
                        }
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className={btnClass}
                        onClick={() => setEditId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-ink">
                        {c.name}{" "}
                        <span className="ml-2 font-mono text-xs text-ink-subtle">
                          {c.slug}
                        </span>
                        <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted">
                          {c.is_active ? "Active" : "Inactive"}
                        </span>
                      </p>
                      {c.description && (
                        <p className="mt-1 text-sm text-ink-muted">
                          {c.description}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-ink-subtle">
                        Order {c.display_order}
                        {c.discord_role_ids.length > 0
                          ? ` | Roles: ${c.discord_role_ids.join(", ")}`
                          : " | No role pings"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={btnClass}
                        onClick={() => {
                          setEditId(c.id);
                          setEName(c.name);
                          setEDesc(c.description ?? "");
                          setERoles(c.discord_role_ids.join(", "));
                          setEOrder(String(c.display_order));
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        className={btnClass}
                        aria-pressed={c.is_active}
                        onClick={() =>
                          run(
                            () => toggleCategory(c.id, !c.is_active),
                            c.is_active ? "Deactivated." : "Activated.",
                          )
                        }
                      >
                        {c.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        className={`${btnClass} hover:border-signal-danger`}
                        onClick={() => {
                          if (confirm(`Delete category "${c.name}"?`)) {
                            run(
                              () => deleteCategory(c.id),
                              "Category deleted.",
                            );
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
