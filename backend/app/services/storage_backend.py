"""Storage backend implementations for local filesystem and S3 persistence."""

import mimetypes
import os
import shutil

try:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError
except ImportError:
    boto3 = None
    BotoCoreError = ClientError = Exception


class StorageError(RuntimeError):
    pass


class FileStorageBackend:
    def ensure_directories(self):
        return None

    def save_filestorage(self, category, filename, filestorage):
        raise NotImplementedError

    def save_bytes(self, category, filename, payload, content_type=None):
        raise NotImplementedError

    def save_path(self, category, filename, source_path, content_type=None):
        raise NotImplementedError

    def read_bytes(self, category, filename):
        raise NotImplementedError

    def delete(self, category, filename):
        raise NotImplementedError

    def resolve_content_type(self, filename, fallback='application/octet-stream'):
        guessed_type, _ = mimetypes.guess_type(filename or '')
        return guessed_type or fallback


class LocalStorageBackend(FileStorageBackend):
    def __init__(self, upload_dir, report_dir):
        self.directories = {
            'upload': os.path.abspath(upload_dir),
            'report': os.path.abspath(report_dir),
        }

    def ensure_directories(self):
        for directory in self.directories.values():
            os.makedirs(directory, exist_ok=True)

    def _destination_path(self, category, filename):
        directory = self.directories.get(category)
        if not directory:
            raise StorageError(f'Unknown storage category: {category}')
        safe_name = os.path.basename(filename or '')
        if not safe_name:
            raise StorageError('A filename is required for storage.')
        return os.path.join(directory, safe_name)

    def save_filestorage(self, category, filename, filestorage):
        destination = self._destination_path(category, filename)
        filestorage.stream.seek(0)
        filestorage.save(destination)
        return os.path.basename(destination)

    def save_bytes(self, category, filename, payload, content_type=None):
        destination = self._destination_path(category, filename)
        with open(destination, 'wb') as output_file:
            output_file.write(payload)
        return os.path.basename(destination)

    def save_path(self, category, filename, source_path, content_type=None):
        destination = self._destination_path(category, filename)
        if os.path.abspath(source_path) != os.path.abspath(destination):
            shutil.copyfile(source_path, destination)
        return os.path.basename(destination)

    def read_bytes(self, category, filename):
        destination = self._destination_path(category, filename)
        if not os.path.exists(destination):
            raise FileNotFoundError(destination)
        with open(destination, 'rb') as input_file:
            return input_file.read()

    def local_file_path(self, category, filename):
        """Return a local path so HTTP downloads can stream instead of reading into RAM."""
        destination = self._destination_path(category, filename)
        if not os.path.isfile(destination):
            raise FileNotFoundError(destination)
        return destination

    def delete(self, category, filename):
        if not filename:
            return
        destination = self._destination_path(category, filename)
        if os.path.exists(destination):
            os.remove(destination)


class S3StorageBackend(FileStorageBackend):
    def __init__(self, bucket, region, upload_prefix='uploads', report_prefix='reports', endpoint_url=None):
        if boto3 is None:
            raise StorageError('boto3 is required for S3 storage support.')
        if not bucket:
            raise StorageError('S3_BUCKET is required when STORAGE_BACKEND=s3.')

        self.bucket = bucket
        self.prefixes = {
            'upload': self._normalize_prefix(upload_prefix, 'uploads'),
            'report': self._normalize_prefix(report_prefix, 'reports'),
        }
        self.client = boto3.client(
            's3',
            region_name=region or None,
            endpoint_url=endpoint_url or None,
        )

    def _normalize_prefix(self, value, fallback):
        normalized = str(value or fallback).strip().strip('/')
        return normalized or fallback

    def _object_key(self, category, filename):
        prefix = self.prefixes.get(category)
        if not prefix:
            raise StorageError(f'Unknown storage category: {category}')
        safe_name = os.path.basename(filename or '')
        if not safe_name:
            raise StorageError('A filename is required for storage.')
        return f'{prefix}/{safe_name}'

    def _upload(self, category, filename, fileobj, content_type=None):
        object_key = self._object_key(category, filename)
        extra_args = {}
        resolved_content_type = content_type or self.resolve_content_type(filename)
        if resolved_content_type:
            extra_args['ContentType'] = resolved_content_type
        try:
            self.client.upload_fileobj(fileobj, self.bucket, object_key, ExtraArgs=extra_args or None)
        except (BotoCoreError, ClientError) as error:
            raise StorageError(f'Failed to upload {filename} to S3: {error}') from error
        return os.path.basename(filename)

    def save_filestorage(self, category, filename, filestorage):
        filestorage.stream.seek(0)
        return self._upload(
            category,
            filename,
            filestorage.stream,
            content_type=getattr(filestorage, 'mimetype', None),
        )

    def save_bytes(self, category, filename, payload, content_type=None):
        from io import BytesIO

        return self._upload(category, filename, BytesIO(payload), content_type=content_type)

    def save_path(self, category, filename, source_path, content_type=None):
        with open(source_path, 'rb') as input_file:
            return self._upload(category, filename, input_file, content_type=content_type)

    def read_bytes(self, category, filename):
        object_key = self._object_key(category, filename)
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=object_key)
        except self.client.exceptions.NoSuchKey as error:
            raise FileNotFoundError(object_key) from error
        except (BotoCoreError, ClientError) as error:
            raise StorageError(f'Failed to read {filename} from S3: {error}') from error
        return response['Body'].read()

    def delete(self, category, filename):
        if not filename:
            return
        object_key = self._object_key(category, filename)
        try:
            self.client.delete_object(Bucket=self.bucket, Key=object_key)
        except (BotoCoreError, ClientError) as error:
            raise StorageError(f'Failed to delete {filename} from S3: {error}') from error


def create_storage_backend(app):
    backend_name = str(os.getenv('STORAGE_BACKEND', 'local')).strip().lower() or 'local'
    upload_dir = app.config['UPLOAD_FOLDER']
    report_dir = app.config['REPORT_FOLDER']

    if backend_name == 's3':
        backend = S3StorageBackend(
            bucket=os.getenv('S3_BUCKET', '').strip(),
            region=os.getenv('AWS_REGION', '').strip(),
            upload_prefix=os.getenv('S3_UPLOAD_PREFIX', 'uploads'),
            report_prefix=os.getenv('S3_REPORT_PREFIX', 'reports'),
            endpoint_url=os.getenv('S3_ENDPOINT_URL', '').strip(),
        )
    else:
        backend = LocalStorageBackend(upload_dir, report_dir)
        backend_name = 'local'

    backend.ensure_directories()
    app.config['STORAGE_BACKEND'] = backend_name
    return backend
