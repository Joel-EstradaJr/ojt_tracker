import { Router } from "express";
import {
  adminAddAlias,
  adminListEntities,
  adminMergeEntities,
  adminReassignAlias,
  adminReviewEntity,
  resolveEntity,
  searchEntities,
} from "../controllers/entity.controller";
import { attachAuthIfPresent, requireAdmin, requireAuth } from "../middleware/auth";

const router = Router();

// Admin moderation + merge endpoints.
router.get("/admin/:type", requireAuth, requireAdmin, adminListEntities);
router.post("/admin/:type/merge", requireAuth, requireAdmin, adminMergeEntities);
router.patch("/admin/:type/:id/review", requireAuth, requireAdmin, adminReviewEntity);
router.post("/admin/:type/:id/aliases", requireAuth, requireAdmin, adminAddAlias);
router.patch("/admin/:type/aliases/:aliasId", requireAuth, requireAdmin, adminReassignAlias);

// Public/optional-auth search and resolve endpoints for typeahead.
router.get("/:type", attachAuthIfPresent, searchEntities);
router.post("/:type/resolve", attachAuthIfPresent, resolveEntity);

export default router;
