from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
# router.register(r'test-cases', views.TestCaseViewSet) # Example if using ViewSets

urlpatterns = [
    # path('', include(router.urls)),
    # We will define explicit paths for the features described in PLAN.md
    path('upload/', views.upload_excel, name='upload_excel'),
    path('generate/', views.generate_script, name='generate_script'),
    path('scripts/<str:case_id>/', views.get_script, name='get_script'),
    path('scripts/<str:case_id>/update/', views.update_script, name='update_script'),
    path('execution/import/', views.import_local_scripts, name='import_local_scripts'),
    path('execution/start/', views.start_execution, name='start_execution'),
    path('execution/stop/', views.stop_execution, name='stop_execution'),
    path('execution/stream/', views.execution_stream, name='execution_stream'),
    path('reports/', views.report_list, name='report_list'),
    path('reports/<int:pk>/', views.report_detail, name='report_detail'),
    path('reports/files/', views.report_files, name='report_files'),
    path('reports/files/<str:filename>', views.serve_report_file, name='serve_report_file'),
    path('dashboard/stats/', views.dashboard_stats, name='dashboard_stats'),
]
