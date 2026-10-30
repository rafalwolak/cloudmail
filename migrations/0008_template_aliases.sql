CREATE UNIQUE INDEX templates_published_alias_idx ON templates (json_extract(published, '$.alias')) WHERE published IS NOT NULL AND json_extract(published, '$.alias') IS NOT NULL;
