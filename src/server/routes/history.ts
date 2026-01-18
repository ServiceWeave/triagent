import { Hono } from "hono";
import { z } from "zod";
import { getHistoryStore } from "../../storage/index.js";
import type { HistoryQueryOptions } from "../../storage/types.js";

const QueryParamsSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  status: z.enum(["pending", "running", "completed", "failed"]).optional(),
  cluster: z.string().optional(),
  tags: z.string().optional(), // comma-separated
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  search: z.string().optional(),
});

export function createHistoryRoutes() {
  const app = new Hono();
  const store = getHistoryStore();

  // List investigations with filtering
  app.get("/", async (c) => {
    try {
      const query = c.req.query();
      const parsed = QueryParamsSchema.safeParse(query);

      if (!parsed.success) {
        return c.json({ error: "Invalid query parameters", details: parsed.error.errors }, 400);
      }

      const options: HistoryQueryOptions = {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        status: parsed.data.status,
        cluster: parsed.data.cluster,
        tags: parsed.data.tags?.split(",").map((t) => t.trim()),
        startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
        searchQuery: parsed.data.search,
      };

      const investigations = await store.list(options);

      return c.json({
        investigations: investigations.map((inv) => ({
          id: inv.id,
          incident: inv.incident,
          status: inv.status,
          cluster: inv.cluster,
          startedAt: inv.startedAt.toISOString(),
          completedAt: inv.completedAt?.toISOString(),
          tags: inv.tags,
          toolCallCount: inv.toolCalls.length,
          eventCount: inv.events.length,
        })),
        count: investigations.length,
      });
    } catch (error) {
      return c.json(
        { error: "Internal server error", message: error instanceof Error ? error.message : String(error) },
        500
      );
    }
  });

  // Get investigation statistics
  app.get("/stats", async (c) => {
    try {
      const stats = await store.getStats();
      return c.json(stats);
    } catch (error) {
      return c.json(
        { error: "Internal server error", message: error instanceof Error ? error.message : String(error) },
        500
      );
    }
  });

  // Get a specific investigation by ID
  app.get("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const investigation = await store.get(id);

      if (!investigation) {
        return c.json({ error: "Investigation not found" }, 404);
      }

      return c.json({
        id: investigation.id,
        incident: investigation.incident,
        status: investigation.status,
        cluster: investigation.cluster,
        startedAt: investigation.startedAt.toISOString(),
        completedAt: investigation.completedAt?.toISOString(),
        result: investigation.result,
        rawResult: investigation.rawResult,
        error: investigation.error,
        tags: investigation.tags,
        toolCalls: investigation.toolCalls.map((tc) => ({
          ...tc,
          timestamp: tc.timestamp.toISOString(),
        })),
        events: investigation.events.map((ev) => ({
          ...ev,
          timestamp: ev.timestamp.toISOString(),
        })),
      });
    } catch (error) {
      return c.json(
        { error: "Internal server error", message: error instanceof Error ? error.message : String(error) },
        500
      );
    }
  });

  // Get events for an investigation
  app.get("/:id/events", async (c) => {
    try {
      const id = c.req.param("id");
      const investigation = await store.get(id);

      if (!investigation) {
        return c.json({ error: "Investigation not found" }, 404);
      }

      return c.json({
        events: investigation.events.map((ev) => ({
          ...ev,
          timestamp: ev.timestamp.toISOString(),
        })),
      });
    } catch (error) {
      return c.json(
        { error: "Internal server error", message: error instanceof Error ? error.message : String(error) },
        500
      );
    }
  });

  // Get tool calls for an investigation
  app.get("/:id/toolcalls", async (c) => {
    try {
      const id = c.req.param("id");
      const investigation = await store.get(id);

      if (!investigation) {
        return c.json({ error: "Investigation not found" }, 404);
      }

      return c.json({
        toolCalls: investigation.toolCalls.map((tc) => ({
          ...tc,
          timestamp: tc.timestamp.toISOString(),
        })),
      });
    } catch (error) {
      return c.json(
        { error: "Internal server error", message: error instanceof Error ? error.message : String(error) },
        500
      );
    }
  });

  // Delete an investigation
  app.delete("/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const deleted = await store.delete(id);

      if (!deleted) {
        return c.json({ error: "Investigation not found" }, 404);
      }

      return c.json({ message: "Investigation deleted" });
    } catch (error) {
      return c.json(
        { error: "Internal server error", message: error instanceof Error ? error.message : String(error) },
        500
      );
    }
  });

  // Export investigation as JSON
  app.get("/:id/export", async (c) => {
    try {
      const id = c.req.param("id");
      const investigation = await store.get(id);

      if (!investigation) {
        return c.json({ error: "Investigation not found" }, 404);
      }

      c.header("Content-Type", "application/json");
      c.header("Content-Disposition", `attachment; filename="investigation-${id}.json"`);

      return c.json(investigation);
    } catch (error) {
      return c.json(
        { error: "Internal server error", message: error instanceof Error ? error.message : String(error) },
        500
      );
    }
  });

  return app;
}
