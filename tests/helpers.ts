import { ErmTable, expandedColumns } from '../src/erm/model';
import { addColumn, addTable, createRelation, emptyDiagram } from '../src/erm/ops';

export function buildShop() {
  const d = emptyDiagram();
  const users = addTable(d, 60, 60);
  users.physicalName = 'users';
  users.logicalName = 'Users';
  const uEmail = addColumn(users, 'email', 'varchar(255)');
  uEmail.notNull = 'true';
  uEmail.uniqueKey = 'true';

  const orders = addTable(d, 420, 60);
  orders.physicalName = 'orders';
  orders.logicalName = 'Orders';
  const oUser = addColumn(orders, 'user_id', 'integer');
  oUser.notNull = 'true';
  const oCreated = addColumn(orders, 'created_at', 'timestamp');
  oCreated.defaultValue = 'now()';

  const products = addTable(d, 60, 320);
  products.physicalName = 'products';
  addColumn(products, 'price', 'numeric(10,2)').notNull = 'true';

  const items = addTable(d, 420, 320);
  items.physicalName = 'order_items';
  const iOrder = addColumn(items, 'order_id', 'integer');
  const iProduct = addColumn(items, 'product_id', 'integer');

  const pkOf = (t: ErmTable) => expandedColumns(t).find((c) => c.primaryKey === 'true')!;
  createRelation(d, orders, oUser, users, pkOf(users)).onDeleteAction = 'CASCADE';
  createRelation(d, items, iOrder, orders, pkOf(orders));
  createRelation(d, items, iProduct, products, pkOf(products));
  return d;
}
