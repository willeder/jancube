-- Consolidate the previous store role into scoped admin grants without widening store scope.
INSERT IGNORE INTO staff_role_grants (staff_id,role_id,store_id,granted_by)
SELECT g.staff_id,a.id,g.store_id,g.granted_by FROM staff_role_grants g
JOIN roles r ON r.id=g.role_id AND r.code='store_staff' JOIN roles a ON a.code='admin';
DELETE g FROM staff_role_grants g JOIN roles r ON r.id=g.role_id WHERE r.code='store_staff';
DELETE rp FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.code='store_staff';
DELETE FROM roles WHERE code='store_staff';
INSERT IGNORE INTO role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p WHERE r.code='admin';
