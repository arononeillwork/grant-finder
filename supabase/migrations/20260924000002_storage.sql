-- Private bucket for client documents (10 MB; PDF, images, Word/RTF). Uploads use signed URLs from create-case.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('case-documents', 'case-documents', false, 10485760,
  array['application/pdf','image/jpeg','image/png','image/webp','application/rtf','text/rtf',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
