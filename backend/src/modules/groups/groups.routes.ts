import { Router } from "express";
import { requireAuth } from "../../middlewares/auth";
import { pool } from "../../db/pool";

const groupsRouter = Router();

groupsRouter.get("/", requireAuth, async (req, res) => {
  const user = req.user!;

  if (user.role === "admin") {
    const result = await pool.query(`SELECT id, name FROM groups ORDER BY name`);
    res.json(result.rows);
    return;
  }

  const result = await pool.query(
    `SELECT g.id, g.name
     FROM groups g
     INNER JOIN user_groups ug ON ug.group_id = g.id
     WHERE ug.user_id = $1
     ORDER BY g.name`,
    [user.id],
  );
  res.json(result.rows);
});

export { groupsRouter };
