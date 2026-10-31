from django.urls import path

from . import views

urlpatterns = [
    path("lookup/", views.lookup),
    path("jobs/<int:job_id>/", views.job_detail),
    path("hospitals/<int:hospital_id>/", views.hospital_detail),
    path("hospitals/<int:hospital_id>/refresh/", views.refresh),
]
