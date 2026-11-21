import os

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.utils.deconstruct import deconstructible


@deconstructible
class PrivateStorage(FileSystemStorage):
    """
    Where medical record files live: settings.PRIVATE_MEDIA_ROOT (a Docker volume), outside every public folder.

    It has no URL on purpose (`.url()` raises an error): the only way to get a file is the API's download
    endpoint, which checks who is asking. The folder is read from settings on every use, so tests can point
    it at a temporary directory.
    """

    @property
    def base_location(self):
        return settings.PRIVATE_MEDIA_ROOT

    @property
    def location(self):
        return os.path.abspath(self.base_location)

    @property
    def base_url(self):
        return None


private_storage = PrivateStorage()
